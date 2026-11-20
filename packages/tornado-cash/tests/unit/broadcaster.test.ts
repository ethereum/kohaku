import { toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { TornadoBroadcastError } from '../../src';
import { TornadoCashBroadcaster } from '../../src/plugin/broadcaster';
import { PaymasterBroadcastError } from '../../src/relayer/interfaces/paymaster-client.interface';

const relayerWithdrawal = (relayerUrl: string) => ({ mode: 'relayer', relayerUrl, poolAddress: 1n, proof: { proof: '0x', args: [] } });
const paymasterWithdrawal = (bundlerUrl: string) => ({ mode: 'paymaster', bundlerUrl });

/** Relayers and bundlers answer by URL: a URL containing "fail" rejects. */
const makeBroadcaster = (reason = 'relayer unavailable') => {
  const withdraw = vi.fn(async (relayerUrl: string) => {
    if (relayerUrl.includes('fail')) throw new Error(reason);

    // eslint-disable-next-line no-restricted-syntax
    return { id: `job-${relayerUrl}` };
  });
  const broadcast = vi.fn(async ([{ bundlerUrl }]: { bundlerUrl: string }[]) => {
    if (bundlerUrl.includes('fail')) throw new PaymasterBroadcastError('not-accepted', 'Bundler did not accept the userOp: AA23 reverted');

    return [{ userOpHash: `hash-${bundlerUrl}`, wait: async () => ({ txHash: `tx-${bundlerUrl}` }) }];
  });
  const broadcaster = new TornadoCashBroadcaster({
    host: { network: {}, provider: {} } as never,
    paymasterConfig: {},
    relayerClientFactory: () => ({ withdraw }) as never,
    paymasterClientFactory: () => ({ broadcast }) as never,
  });

  return { broadcaster, withdraw, broadcast };
};

// eslint-disable-next-line no-restricted-syntax
const ids = (responses: { id: string }[]) => responses.map(({ id }) => id);

const catchBroadcastError = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => { throw new Error('expected a rejection'); }, (reason: unknown) => reason);

  expect(error).toBeInstanceOf(TornadoBroadcastError);

  return error as TornadoBroadcastError;
};

describe('TornadoCashBroadcaster results', () => {
  it('resolves with one response per withdrawal, in input order, across modes', async () => {
    const { broadcaster } = makeBroadcaster();
    const withdrawals = [relayerWithdrawal('a'), paymasterWithdrawal('b'), relayerWithdrawal('c')];

    expect(ids(await broadcaster.broadcast({ withdrawals } as never))).toEqual(['job-a', 'hash-b', 'job-c']);
  });

  it('reports a failed relayer withdrawal with every outcome in input order, after sending the rest', async () => {
    const { broadcaster, withdraw } = makeBroadcaster();
    const withdrawals = [relayerWithdrawal('a'), relayerWithdrawal('fail'), relayerWithdrawal('c')];
    const error = await catchBroadcastError(broadcaster.broadcast({ withdrawals } as never));

    expect(withdraw).toHaveBeenCalledTimes(3);
    expect(error.message).toContain('1 of 3 withdrawals failed');
    expect(error.message).toContain('#1: relayer unavailable');
    expect(error.results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(ids(error.results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))).toEqual(['job-a', 'job-c']);
    expect((error.results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
  });

  it('keeps accepted paymaster userOps when another is rejected', async () => {
    const { broadcaster } = makeBroadcaster();
    const withdrawals = [paymasterWithdrawal('a'), paymasterWithdrawal('fail')];
    const error = await catchBroadcastError(broadcaster.broadcast({ withdrawals } as never));
    const [sent, rejected] = error.results;

    // eslint-disable-next-line no-restricted-syntax
    expect(sent).toMatchObject({ status: 'fulfilled', value: { id: 'hash-a' } });
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ failure: 'not-accepted' });
  });

  it.each([
    ['relayer', relayerWithdrawal('fail'), Error],
    ['paymaster', paymasterWithdrawal('fail'), PaymasterBroadcastError],
  ])('rethrows the original error of a single %s withdrawal', async (_mode, withdrawal, type) => {
    const { broadcaster } = makeBroadcaster();
    const error = await broadcaster.broadcast({ withdrawals: [withdrawal] } as never).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(type);
    expect(error).not.toBeInstanceOf(TornadoBroadcastError);
  });

  it('wraps a non-Error thrown for a single withdrawal in a TornadoBroadcastError', async () => {
    const { broadcaster, withdraw } = makeBroadcaster();

    withdraw.mockRejectedValueOnce('relayer down');
    const error = await catchBroadcastError(broadcaster.broadcast({ withdrawals: [relayerWithdrawal('a')] } as never));

    expect(error.message).toContain('#0: Unknown error.');
    expect((error.results[0] as PromiseRejectedResult).reason).toBe('relayer down');
  });

  it('bounds each failure reason in the message', async () => {
    const { broadcaster } = makeBroadcaster('x'.repeat(5_000));
    const error = await catchBroadcastError(broadcaster.broadcast({ withdrawals: [relayerWithdrawal('a'), relayerWithdrawal('fail')] } as never));

    expect(error.message.length).toBeLessThan(400);
  });
});

describe('TornadoCashBroadcaster paymaster nonce check', () => {
  const withdrawal = { mode: 'paymaster', bundlerUrl: 'http://bundler', entryPointAddress: `0x${'43'.repeat(20)}`, userOperation: { sender: `0x${'aa'.repeat(20)}`, nonce: '0x0' } };
  /** The sender's EntryPoint nonce is already 1, past the signed 0. */
  const makeNonceBroadcaster = (broadcast: () => Promise<unknown>) => new TornadoCashBroadcaster({
    host: { network: {}, provider: { request: async () => toHex(1n, { size: 32 }) } } as never,
    paymasterConfig: {},
    relayerClientFactory: () => ({}) as never,
    paymasterClientFactory: () => ({ broadcast }) as never,
  });

  it('reports staleNonce when the bundler refuses a withdrawal whose sender nonce moved', async () => {
    const broadcaster = makeNonceBroadcaster(async () => { throw new PaymasterBroadcastError('not-accepted', 'Bundler error -32602.'); });
    const error = await broadcaster.broadcast({ withdrawals: [withdrawal] } as never).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PaymasterBroadcastError);
    expect(error).toMatchObject({ staleNonce: { kind: 'entry-point', signed: 0n, current: 1n } });
    expect((error as Error).message).toContain('sync before preparing another withdrawal');
  });

  it('still resolves a rebroadcast of a withdrawal that landed, which moved the nonce', async () => {
    const broadcaster = makeNonceBroadcaster(async () => [{ userOpHash: `0x${'cc'.repeat(32)}`, wait: async () => ({}) }]);

    // eslint-disable-next-line no-restricted-syntax
    expect(await broadcaster.broadcast({ withdrawals: [withdrawal] } as never)).toMatchObject([{ id: `0x${'cc'.repeat(32)}` }]);
  });
});
