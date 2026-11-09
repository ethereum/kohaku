import type { Network } from '@kohaku-eth/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymasterBroadcaster } from '../../src/paymaster/paymaster-broadcaster';
import { PrivacyPoolsBroadcaster } from '../../src/plugin/broadcaster';
import {
  IGenericPaymasterWithdrawalPayload,
  PaymasterBroadcastError,
} from '../../src/relayer/interfaces/paymaster-client.interface';

const USER_OP_HASH = `0x${'aa'.repeat(32)}` as const;
const TX_HASH = `0x${'bb'.repeat(32)}` as const;
const SIGNATURE = `0x${'5e'.repeat(65)}` as const;
const ADDRESS = `0x${'11'.repeat(20)}` as const;
const BUNDLER_URL = 'http://mock.bundler';

const withdrawal = {
  bundlerUrl: BUNDLER_URL,
  entryPointAddress: ADDRESS,
  userOperation: { sender: ADDRESS, signature: SIGNATURE },
} as unknown as IGenericPaymasterWithdrawalPayload;

const makeReceipt = (success: boolean, reason?: string) => ({
  userOpHash: USER_OP_HASH,
  entryPoint: ADDRESS,
  sender: ADDRESS,
  nonce: '0x0',
  paymaster: ADDRESS,
  actualGasUsed: '0x1',
  actualGasCost: '0x1',
  success,
  reason,
  logs: [],
  receipt: {
    transactionHash: TX_HASH,
    transactionIndex: '0x0',
    blockHash: TX_HASH,
    blockNumber: '0x1',
    from: ADDRESS,
    to: ADDRESS,
    cumulativeGasUsed: '0x1',
    gasUsed: '0x1',
    effectiveGasPrice: '0x1',
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
  },
});

type Handler = (method: string, url: string) => { result?: unknown; error?: { code: number; message: string } } | Response;

/** A bundler behind viem's real transport, so errors have viem's real shape. */
const makeNetwork = (handler: Handler) => {
  const calls: string[] = [];
  const network = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string);

      calls.push(request.method);

      const response = handler(request.method, String(input));

      return response instanceof Response
        ? response
        : new Response(JSON.stringify({ ...request, params: undefined, ...response }));
    },
  } as unknown as Network;

  return { network, calls };
};

const accepted = (onReceipt: () => ReturnType<Handler>): Handler => (method) =>
  method === 'eth_sendUserOperation' ? { result: USER_OP_HASH } : onReceipt();

const catchError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => { throw new Error('expected a rejection'); },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(PaymasterBroadcastError);

  return error as PaymasterBroadcastError;
};

/** Nothing reachable from the error may expose the signed userOp. */
const expectNoUserOp = (error: PaymasterBroadcastError) => {
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(SIGNATURE);
};

describe('PaymasterBroadcaster', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the userOp hash without waiting for a receipt', async () => {
    const { network, calls } = makeNetwork(accepted(() => ({ result: null })));

    const [{ userOpHash }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);

    expect(userOpHash).toBe(USER_OP_HASH);
    expect(calls).toEqual(['eth_sendUserOperation']);
  });

  it('wait() returns the tx hash of a successful userOp', async () => {
    const { network } = makeNetwork(accepted(() => ({ result: makeReceipt(true) })));

    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);

    await expect(wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('wait() throws `reverted` when the receipt has success: false', async () => {
    const { network } = makeNetwork(accepted(() => ({ result: makeReceipt(false, 'AA33 boom') })));

    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);
    const error = await catchError(wait());

    expect(error.failure).toBe('reverted');
    expect(error.userOpHash).toBe(USER_OP_HASH);
    expect(error.txHash).toBe(TX_HASH);
    expect(error.message).toContain('AA33 boom');
  });

  it('wait() throws `unconfirmed` on a receipt timeout, and can be retried', async () => {
    vi.useFakeTimers();

    let receipt: unknown = null;
    const { network } = makeNetwork(accepted(() => ({ result: receipt })));

    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);
    const pending = catchError(wait());

    await vi.advanceTimersByTimeAsync(120_000);

    const error = await pending;

    expect(error.failure).toBe('unconfirmed');
    expect(error.userOpHash).toBe(USER_OP_HASH);
    expect(error.txHash).toBeUndefined();

    receipt = makeReceipt(true);
    vi.useRealTimers();

    await expect(wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('wait() throws `unconfirmed` without the userOp when polling fails', async () => {
    const { network } = makeNetwork(accepted(() => ({ error: { code: -32603, message: 'bundler down' } })));

    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);
    const error = await catchError(wait());

    expect(error.failure).toBe('unconfirmed');
    expect(error.message).toContain('bundler down');
    expectNoUserOp(error);
  });

  it('throws `not-accepted` with the real reason but no userOp on an RPC error', async () => {
    const { network } = makeNetwork(() => ({ error: { code: -32500, message: 'AA23 reverted' } }));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.userOpHash).toBeUndefined();
    expect(error.message).toContain('AA23 reverted');
    expectNoUserOp(error);
  });

  it('throws `not-accepted` without the userOp on an HTTP error', async () => {
    const { network } = makeNetwork(() => new Response('nope', { status: 400 }));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toContain('HTTP request failed');
    expectNoUserOp(error);
  });

  it('returns one result per withdrawal, in order', async () => {
    const OTHER_HASH = `0x${'cc'.repeat(32)}` as const;
    const other = { ...withdrawal, bundlerUrl: 'http://other.bundler' };
    const { network } = makeNetwork((_method, url) => ({
      result: url.startsWith('http://other.bundler') ? OTHER_HASH : USER_OP_HASH,
    }));

    const results = await new PaymasterBroadcaster({ network }).broadcast([withdrawal, other]);

    expect(results.map((r) => r.userOpHash)).toEqual([USER_OP_HASH, OTHER_HASH]);
  });

  it('rejects instead of omitting a withdrawal the bundler did not accept', async () => {
    const other = { ...withdrawal, bundlerUrl: 'http://other.bundler' };
    const { network } = makeNetwork((_method, url) => url.startsWith('http://other.bundler')
      ? { error: { code: -32500, message: 'AA23 reverted' } }
      : { result: USER_OP_HASH });

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal, other]));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toContain('AA23 reverted');
  });
});

describe('PrivacyPoolsBroadcaster paymaster path', () => {
  const makeBroadcaster = (network: Network) => new PrivacyPoolsBroadcaster({
    host: { network } as never,
    broadcasterUrl: 'http://mock.relayer',
    relayerClientFactory: () => ({} as never),
  });
  const operation = { mode: 'paymaster', withdrawal } as never;

  it('returns the userOp hash as the requestId and forwards wait()', async () => {
    const { network } = makeNetwork(accepted(() => ({ result: makeReceipt(true) })));

    const response = await makeBroadcaster(network).broadcast(operation);

    expect(response.success).toBe(true);
    expect(response.requestId).toBe(USER_OP_HASH);
    await expect(response.wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('propagates the real error instead of a generic one', async () => {
    const { network } = makeNetwork(() => ({ error: { code: -32500, message: 'AA23 reverted' } }));

    const error = await catchError(makeBroadcaster(network).broadcast(operation));

    expect(error.message).toContain('AA23 reverted');
    expectNoUserOp(error);
  });
});
