import type { Network } from '@kohaku-eth/plugins';
import { recoverAddress, type Hash } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address, getUserOperationHash } from 'viem/account-abstraction';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PaymasterBroadcaster } from '../../src/paymaster/paymaster-broadcaster';
import { buildSignedTornadoUserOp, serializedUserOperationHash } from '../../src/paymaster/utils';
import { TornadoCashBroadcaster } from '../../src/plugin/broadcaster';
import {
  IGenericPaymasterWithdrawalPayload,
  PaymasterBroadcastError,
} from '../../src/relayer/interfaces/paymaster-client.interface';

const TX_HASH = `0x${'bb'.repeat(32)}` as const;
const ADDRESS = `0x${'11'.repeat(20)}` as const;
const BUNDLER_URL = 'http://mock.bundler';
const CHAIN_ID = 11155111;

const signer = privateKeyToAccount(generatePrivateKey());
let withdrawal: IGenericPaymasterWithdrawalPayload;
let USER_OP_HASH: Hash;

beforeAll(async () => {
  const userOperation = await buildSignedTornadoUserOp({
    signer,
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint08Address,
    paymasterAddress: ADDRESS,
    paymasterData: '0x1234',
    gas: {
      callGasLimit: 100_000n,
      verificationGasLimit: 500_000n,
      preVerificationGas: 60_000n,
      paymasterVerificationGasLimit: 900_000n,
      paymasterPostOpGasLimit: 50_000n,
    },
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    tailCalls: async () => [{ to: ADDRESS, value: 1n, data: '0x' }],
  });

  withdrawal = {
    mode: 'paymaster',
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: entryPoint08Address,
    userOperation,
  } as unknown as IGenericPaymasterWithdrawalPayload;
  USER_OP_HASH = serializedUserOperationHash(userOperation, entryPoint08Address)!;
});

const makeReceipt = (success: boolean, reason?: string) => ({
  userOpHash: USER_OP_HASH,
  entryPoint: entryPoint08Address,
  sender: signer.address,
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

/** The send request fails; `onLookup` answers `eth_getUserOperationByHash` (unknown by default). */
const sendFails = (
  sendResponse: () => ReturnType<Handler>,
  onLookup: () => ReturnType<Handler> = () => ({ result: null }),
): Handler => (method) => {
  if (method === 'eth_sendUserOperation') return sendResponse();

  return method === 'eth_getUserOperationByHash' ? onLookup() : { result: makeReceipt(true) };
};

const AA23 = () => ({ error: { code: -32500, message: 'AA23 reverted' } });

const catchError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => { throw new Error('expected a rejection'); },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(PaymasterBroadcastError);

  return error as PaymasterBroadcastError;
};

/** Nothing reachable from the error may expose the signed userOp. */
const expectNoUserOp = (error: Error) => {
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify({ ...error, message: error.message, stack: error.stack }))
    .not.toContain(withdrawal.userOperation.signature.slice(2));
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
    // Only the AA code: the rest of the reason is bundler text.
    expect(error.message).toContain('(AA33)');
    expect(error.message).not.toContain('boom');
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
    expect(error.message).toContain('Bundler error -32603');
    expect(error.message).not.toContain('bundler down');
    expectNoUserOp(error);
  });

  it('throws `not-accepted` with the real reason and the hash, but no userOp, on an RPC error', async () => {
    const { network } = makeNetwork(sendFails(AA23));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.userOpHash).toBe(USER_OP_HASH);
    expect(error.message).toContain('(AA23)');
    expect(error.message).not.toContain('AA23 reverted');
    expectNoUserOp(error);
  });

  it('throws `not-accepted` on an RPC error even when the lookup fails', async () => {
    const { network } = makeNetwork(sendFails(AA23, () => ({ error: { code: -32601, message: 'method not supported' } })));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toContain('(AA23)');
    expect(error.message).not.toContain('AA23 reverted');
  });

  it('throws `unconfirmed` with the hash when the send response is lost and the bundler does not know the userOp yet', async () => {
    const { network, calls } = makeNetwork(sendFails(() => { throw new Error('socket hang up'); }));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('unconfirmed');
    expect(error.userOpHash).toBe(USER_OP_HASH);
    // Not retried: a retry would be rejected like an invalid userOp.
    expect(calls).toEqual(['eth_sendUserOperation', 'eth_getUserOperationByHash']);
    expectNoUserOp(error);
  });

  it('throws `unconfirmed` without the userOp on an HTTP error', async () => {
    const { network } = makeNetwork(sendFails(() => new Response('nope', { status: 400 })));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('unconfirmed');
    expect(error.message).toContain('HTTP request failed');
    expectNoUserOp(error);
  });

  it('recovers when the send response is lost but the bundler finds the userOp', async () => {
    const pending = { userOperation: withdrawal.userOperation, entryPoint: entryPoint08Address, blockNumber: null, blockHash: null, transactionHash: null };
    const { network, calls } = makeNetwork(sendFails(
      () => { throw new Error('socket hang up'); },
      () => ({ result: pending }),
    ));

    const [{ userOpHash, wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);

    expect(userOpHash).toBe(USER_OP_HASH);
    expect(calls).toEqual(['eth_sendUserOperation', 'eth_getUserOperationByHash']);
    await expect(wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('treats "Already known" as accepted, even if the bundler cannot find pending userOps', async () => {
    const { network, calls } = makeNetwork(sendFails(() => ({ error: { code: -32602, message: 'Already known' } })));

    const [{ userOpHash, wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);

    expect(userOpHash).toBe(USER_OP_HASH);
    expect(calls).toEqual(['eth_sendUserOperation']);
    await expect(wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('throws `not-accepted` when a different userOp with the same sender and nonce is pending', async () => {
    const { network } = makeNetwork(sendFails(() => ({
      error: { code: -32602, message: 'AA25 invalid account nonce: Another UserOperation with same sender and nonce is already being processed' },
    })));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.userOpHash).toBe(USER_OP_HASH);
  });

  it('throws `unconfirmed` with the hash when the send fails and the lookup fails too', async () => {
    const { network } = makeNetwork(sendFails(
      () => new Response('gateway timeout', { status: 504 }),
      () => ({ error: { code: -32601, message: 'method not supported' } }),
    ));

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('unconfirmed');
    expect(error.userOpHash).toBe(USER_OP_HASH);
    expect(error.message).toContain('HTTP request failed');
    expectNoUserOp(error);
  });

  it('returns one result per withdrawal, in order', async () => {
    const other = { ...withdrawal, bundlerUrl: 'http://other.bundler', userOperation: { ...withdrawal.userOperation, nonce: '0x1' } };
    const OTHER_HASH = serializedUserOperationHash(other.userOperation, entryPoint08Address)!;
    const { network } = makeNetwork((_method, url) => ({
      result: url.startsWith('http://other.bundler') ? OTHER_HASH : USER_OP_HASH,
    }));

    const results = await new PaymasterBroadcaster({ network }).broadcast([withdrawal, other]);

    expect(results.map((r) => r.userOpHash)).toEqual([USER_OP_HASH, OTHER_HASH]);
  });

  it('rejects instead of omitting a withdrawal the bundler did not accept', async () => {
    const other = { ...withdrawal, bundlerUrl: 'http://other.bundler' };
    const { network } = makeNetwork((method, url) => url.startsWith('http://other.bundler')
      ? sendFails(AA23)(method, url)
      : { result: USER_OP_HASH });

    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal, other]));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toContain('(AA23)');
    expect(error.message).not.toContain('AA23 reverted');
  });
});

describe('TornadoCashBroadcaster paymaster path', () => {
  const makeBroadcaster = (network: Network) => new TornadoCashBroadcaster({
    host: { network, provider: {} } as never,
    paymasterConfig: {},
    relayerClientFactory: () => ({} as never),
  });
  const operation = () => ({ withdrawals: [withdrawal] }) as never;

  it('returns the userOp hash as the id and forwards wait()', async () => {
    const { network } = makeNetwork(accepted(() => ({ result: makeReceipt(true) })));

    const [response] = await makeBroadcaster(network).broadcast(operation());

    // eslint-disable-next-line no-restricted-syntax
    expect(response!.id).toBe(USER_OP_HASH);
    await expect(response!.wait()).resolves.toEqual({ txHash: TX_HASH });
  });

  it('propagates the real error instead of dropping the withdrawal', async () => {
    const { network } = makeNetwork(sendFails(AA23));

    const error = await catchError(makeBroadcaster(network).broadcast(operation()));

    expect(error.message).toContain('(AA23)');
    expect(error.message).not.toContain('AA23 reverted');
    expectNoUserOp(error);
  });
});

describe('serializedUserOperationHash', () => {
  it('returns the EntryPoint v0.8 hash of the userOp, which is what the signer signed', async () => {
    const { userOperation } = withdrawal;

    expect(await recoverAddress({ hash: USER_OP_HASH, signature: userOperation.signature })).toBe(signer.address);
    expect(USER_OP_HASH).toBe(getUserOperationHash({
      chainId: CHAIN_ID,
      entryPointAddress: entryPoint08Address,
      entryPointVersion: '0.8',
      userOperation: {
        sender: userOperation.sender,
        nonce: BigInt(userOperation.nonce),
        callData: userOperation.callData,
        callGasLimit: BigInt(userOperation.callGasLimit),
        verificationGasLimit: BigInt(userOperation.verificationGasLimit),
        preVerificationGas: BigInt(userOperation.preVerificationGas),
        maxFeePerGas: BigInt(userOperation.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(userOperation.maxPriorityFeePerGas),
        paymaster: userOperation.paymaster,
        paymasterVerificationGasLimit: BigInt(userOperation.paymasterVerificationGasLimit!),
        paymasterPostOpGasLimit: BigInt(userOperation.paymasterPostOpGasLimit!),
        paymasterData: userOperation.paymasterData,
        signature: userOperation.signature,
      },
    }));
  });

  it('is undefined without a 7702 authorization, which carries the chain', () => {
    const userOperation = { ...withdrawal.userOperation, eip7702Auth: undefined };

    expect(serializedUserOperationHash(userOperation, entryPoint08Address)).toBeUndefined();
  });
});

describe('PaymasterBroadcaster with untrusted bundler replies', () => {
  const OTHER = `0x${'cc'.repeat(32)}` as const;
  const lookups = (result: unknown) => sendFails(() => { throw new Error('socket hang up'); }, () => ({ result }));

  it.each([
    ['a non-hash', true],
    ['an object', {}],
    ['a different userOp hash', OTHER],
  ])('does not report a send answered with %s as accepted', async (_case, result) => {
    const { network } = makeNetwork((method) => method === 'eth_sendUserOperation' ? { result } : { result: null });
    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('unconfirmed');
    expect(error.userOpHash).toBe(USER_OP_HASH);
  });

  it.each([
    ['a non-object', true],
    ['an empty object', {}],
    ['another sender', { userOperation: { sender: `0x${'99'.repeat(20)}`, nonce: '0x0' }, entryPoint: entryPoint08Address }],
    ['another nonce', { userOperation: { sender: signer.address, nonce: '0x1' }, entryPoint: entryPoint08Address }],
    ['another EntryPoint', { userOperation: { sender: signer.address, nonce: '0x0' }, entryPoint: `0x${'99'.repeat(20)}` }],
    ['no operation body', { entryPoint: entryPoint08Address }],
    ['only the same sender and nonce', { userOperation: { sender: signer.address, nonce: '0x0' }, entryPoint: entryPoint08Address }],
  ])('does not treat a lookup answered with %s as the userOp', async (_case, result) => {
    const { network } = makeNetwork(lookups(result));

    expect((await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]))).failure).toBe('unconfirmed');
  });

  it.each(['callData', 'maxFeePerGas', 'signature'] as const)('does not treat another userOp with the same sender and nonce (different %s) as this one', async (field) => {
    const op = withdrawal.userOperation as unknown as Record<string, string>;
    const different = { ...op, [field]: field === 'maxFeePerGas' ? `0x${(BigInt(op.maxFeePerGas ?? '0x1') + 1n).toString(16)}` : `0x${'ab'.repeat(65)}` };
    const { network } = makeNetwork(lookups({ userOperation: different, entryPoint: entryPoint08Address }));

    expect((await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]))).failure).toBe('unconfirmed');
  });

  it('does not treat the userOp with a factory it was not signed with as this one', async () => {
    const lookupOf = (userOperation: object) => new PaymasterBroadcaster({ network: makeNetwork(lookups({ userOperation, entryPoint: entryPoint08Address })).network }).broadcast([withdrawal]);

    expect(withdrawal.userOperation.factory).toBeUndefined();
    // Control: the lookup of the operation as sent is recognized.
    await expect(lookupOf({ ...withdrawal.userOperation })).resolves.toHaveLength(1);

    const added = { ...withdrawal.userOperation, factory: `0x${'88'.repeat(20)}`, factoryData: '0x1234' };

    expect((await catchError(lookupOf(added))).failure).toBe('unconfirmed');
  });

  // Built lazily: the fixture userOp hash is only known once the suite runs.
  it.each([
    ['a string success', () => ({ ...makeReceipt(true), success: 'false' })],
    ['another userOp', () => ({ ...makeReceipt(true), userOpHash: OTHER })],
    ['no transaction hash', () => ({ ...makeReceipt(true), receipt: {} })],
    ['success in a reverted transaction', () => ({ ...makeReceipt(true), receipt: { ...makeReceipt(true).receipt, status: '0x0' } })],
    ['success without a transaction status', () => ({ ...makeReceipt(true), receipt: { ...makeReceipt(true).receipt, status: undefined } })],
    ['a revert in a reverted transaction', () => ({ ...makeReceipt(false), receipt: { ...makeReceipt(false).receipt, status: '0x0' } })],
    ['a revert without a transaction status', () => ({ ...makeReceipt(false), receipt: { ...makeReceipt(false).receipt, status: undefined } })],
  ])('does not confirm a receipt with %s', async (_case, receipt) => {
    const { network } = makeNetwork(accepted(() => ({ result: receipt() })));
    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);
    const error = await catchError(wait());

    expect(error.failure).toBe('unconfirmed');
    expect(error.message).toContain('malformed receipt');
  });

  it('still reports a userOp that reverted inside a successful transaction as reverted', async () => {
    const { network } = makeNetwork(accepted(() => ({ result: makeReceipt(false) })));
    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);

    expect((await catchError(wait())).failure).toBe('reverted');
  });

  it('reports a send rejected with a non-string message as not accepted', async () => {
    const { network } = makeNetwork(sendFails(() => ({ error: { code: -32602, message: { text: 'Already known' } as never } })));
    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
  });

  it.each(['UserOperation not already known', 'nonce already known', 'Already known to be invalid'])('does not read "%s" as accepted', async (message) => {
    const { network } = makeNetwork(sendFails(() => ({ error: { code: -32602, message } })));

    expect((await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]))).failure).toBe('not-accepted');
  });

  it.each([
    ['whole', (signature: string) => `invalid userOp {"signature":"${signature}"}`],
    ['in short chunks', (signature: string) => `invalid userOp ${signature.match(/.{1,16}/g)!.join(' ')}`],
  ])('keeps bundler text out of the error when it echoes the signed userOp %s', async (_case, echo) => {
    const { network } = makeNetwork(sendFails(() => ({ error: { code: -32602, message: `AA23 ${echo(withdrawal.userOperation.signature)}` } })));
    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.message).toContain('Bundler error -32602 (AA23)');
    expect(error.message).not.toContain('invalid userOp');
    expect(error.message).not.toContain(withdrawal.userOperation.signature.slice(2, 18));
    expectNoUserOp(error);
  });

  it('reports the JSON-RPC code only when it is an integer', async () => {
    const { network } = makeNetwork(sendFails(() => ({ error: { code: `-32602 ${withdrawal.userOperation.signature}` as never, message: 'AA23 reverted' } })));
    const error = await catchError(new PaymasterBroadcaster({ network }).broadcast([withdrawal]));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toContain('Bundler error (AA23).');
    expect(error.message).not.toContain(withdrawal.userOperation.signature.slice(2, 18));
  });

  it.each([
    ['echoes the signed userOp', () => `reverted: ${withdrawal.userOperation.signature}`],
    ['has a throwing toString', () => ({ toString: 'not a function' })],
  ])('reports a reverted userOp with its transaction when the reason %s', async (_case, reason) => {
    const { network } = makeNetwork(accepted(() => ({ result: { ...makeReceipt(false), reason: reason() } })));
    const [{ wait }] = await new PaymasterBroadcaster({ network }).broadcast([withdrawal]);
    const error = await catchError(wait());

    expect(error.failure).toBe('reverted');
    expect(error.txHash).toBe(TX_HASH);
    expect(error.message).not.toContain(withdrawal.userOperation.signature.slice(2, 18));
  });
});

describe('PaymasterBroadcaster for a sender without a 7702 authorization', () => {
  it('hashes the userOp with an explicit chain id', () => {
    const userOperation = { ...withdrawal.userOperation, eip7702Auth: undefined };

    expect(serializedUserOperationHash(userOperation, entryPoint08Address, CHAIN_ID)).toBe(USER_OP_HASH);
  });

  it('recovers a lost send response with the stored hash', async () => {
    const smartAccount = { ...withdrawal, userOperation: { ...withdrawal.userOperation, eip7702Auth: undefined }, userOpHash: USER_OP_HASH };
    const found = { userOperation: smartAccount.userOperation, entryPoint: entryPoint08Address };
    const { network, calls } = makeNetwork(sendFails(() => { throw new Error('socket hang up'); }, () => ({ result: found })));
    const [{ userOpHash }] = await new PaymasterBroadcaster({ network }).broadcast([smartAccount]);

    expect(userOpHash).toBe(USER_OP_HASH);
    expect(calls).toEqual(['eth_sendUserOperation', 'eth_getUserOperationByHash']);
  });
});
