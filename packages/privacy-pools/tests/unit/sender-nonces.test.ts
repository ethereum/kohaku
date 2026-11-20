import { toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { rethrowWithStaleNonces } from '../../src/paymaster/sender-nonces';
import { PaymasterBroadcastError } from '../../src/relayer/interfaces/paymaster-client.interface';

const SENDER = `0x${'aa'.repeat(20)}` as const;
const ENTRY_POINT = `0x${'43'.repeat(20)}` as const;
const USER_OP_HASH = `0x${'cc'.repeat(32)}` as const;
const KEY = 5n;
const SIGNED_NONCE = (KEY << 64n) | 3n;

const withdrawal = (authorizationNonce?: bigint) => ({
  bundlerUrl: 'http://bundler',
  entryPointAddress: ENTRY_POINT,
  userOperation: {
    sender: SENDER,
    nonce: toHex(SIGNED_NONCE),
    ...(authorizationNonce === undefined ? {} : { eip7702Auth: { nonce: toHex(authorizationNonce) } }),
  },
}) as never;

const refusal = () => new PaymasterBroadcastError('not-accepted', 'Bundler error -32602.', { userOpHash: USER_OP_HASH });

/** A chain whose EntryPoint nonce and transaction count for the sender are the given values. */
const chain = (entryPointNonce: bigint, transactionCount = 0n) => ({
  request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_call') return toHex(entryPointNonce, { size: 32 });

    if (method === 'eth_getTransactionCount') return toHex(transactionCount);

    throw new Error(`unexpected ${method}`);
  }),
});

const thrown = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (reason: unknown) => reason);

describe('rethrowWithStaleNonces', () => {
  it('keeps the refusal when both nonces are still the signed ones, reading the signed nonce key', async () => {
    const provider = chain(SIGNED_NONCE, 7n);
    const error = refusal();

    expect(await thrown(rethrowWithStaleNonces(provider, withdrawal(7n), error))).toBe(error);
    expect(error.staleNonce).toBeUndefined();

    const [{ params: [call] }] = provider.request.mock.calls[0] as unknown as [{ params: [{ to: string; data: string }] }];

    expect(call.to).toBe(ENTRY_POINT);
    expect(call.data.endsWith(toHex(KEY, { size: 32 }).slice(2))).toBe(true);
  });

  it('reports a forward-moved EntryPoint nonce, keeping the userOp hash', async () => {
    const error = await thrown(rethrowWithStaleNonces(chain(SIGNED_NONCE + 1n, 7n), withdrawal(7n), refusal()));

    expect(error).toBeInstanceOf(PaymasterBroadcastError);
    expect(error).toMatchObject({ failure: 'not-accepted', userOpHash: USER_OP_HASH, staleNonce: { kind: 'entry-point', signed: SIGNED_NONCE, current: SIGNED_NONCE + 1n } });
    expect((error as Error).message).toContain('EntryPoint nonce moved past');
    expect((error as Error).message).toContain('sync before preparing another withdrawal');
  });

  it('reports a forward-moved EIP-7702 authorization nonce', async () => {
    const error = await thrown(rethrowWithStaleNonces(chain(SIGNED_NONCE, 8n), withdrawal(7n), refusal()));

    expect(error).toMatchObject({ failure: 'not-accepted', staleNonce: { kind: 'authorization', signed: 7n, current: 8n } });
    expect((error as Error).message).toContain('signed 7, now 8');
  });

  it.each([
    ['EntryPoint', () => chain(SIGNED_NONCE - 1n, 7n)],
    ['transaction', () => chain(SIGNED_NONCE, 6n)],
  ])('keeps the refusal when a lagging provider reports the %s nonce below the signed one', async (_name, provider) => {
    const error = refusal();

    expect(await thrown(rethrowWithStaleNonces(provider(), withdrawal(7n), error))).toBe(error);
    expect(error.staleNonce).toBeUndefined();
  });

  it('does not read the transaction count of a sender without an authorization', async () => {
    const provider = chain(SIGNED_NONCE, 99n);

    await thrown(rethrowWithStaleNonces(provider, withdrawal(), refusal()));

    expect(provider.request.mock.calls.map(([{ method }]) => method)).toEqual(['eth_call']);
  });

  it.each([
    ['an unconfirmed broadcast', new PaymasterBroadcastError('unconfirmed', 'may still land')],
    ['another error', new Error('boom')],
  ])('rethrows %s without reading nonces', async (_name, error) => {
    const provider = chain(SIGNED_NONCE + 1n);

    expect(await thrown(rethrowWithStaleNonces(provider, withdrawal(), error))).toBe(error);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed read', { request: async () => { throw new Error('rpc down'); } }],
    ['a malformed reply', { request: async () => 'nonsense' }],
    ['no provider', undefined],
  ])('keeps the refusal after %s', async (_name, provider) => {
    const error = refusal();

    expect(await thrown(rethrowWithStaleNonces(provider as never, withdrawal(7n), error))).toBe(error);
  });
});
