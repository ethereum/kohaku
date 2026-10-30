import { encodeErrorResult } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeRevert, type Address, type Hex, type PreparedBatch, type PreparedCall } from '../../src/index';
import {
  ACCOUNT,
  ARMING_DATA,
  build,
  COMMITTED,
  DRAFT,
  PIN,
  revert,
  SENDER,
  standingState,
  transportFailure,
  withBackup,
} from './doubles';

const EMPTY_DRAFT = withBackup(DRAFT, 'empty');

/** Revert data of a custom error the decoder knows nothing about. */
const UNKNOWN_REVERT: Hex = '0xdeadbeef';
/** The standard `Error(string)` revert, written out here rather than imported from the package. */
const ERROR_STRING_ABI = [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }] as const;

/** Revert data of the standard `Error(string)`. */
const STRING_REVERT: Hex = encodeErrorResult({
  abi: ERROR_STRING_ABI,
  errorName: 'Error',
  args: ['nope'],
});

describe('simulation of the setup prepares', () => {
  it('simulates every call of the batch in list order, from the account, at the pinned number', async () => {
    const { client, seen } = build();
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT)) as PreparedBatch;

    expect(seen.calls).toHaveLength(2);
    expect(seen.calls[0]?.data).toBe(ARMING_DATA);
    expect(seen.calls[1]?.data).toBe(prepared.calls[1]?.data);

    for (const call of seen.calls) {
      expect(call.from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
      expect(call.block).toBe(PIN.number);
    }

    expect(prepared.calls.map((call) => call.simulation)).toEqual([{ success: true }, { success: true }]);
  });

  it('runs from the account even where options.from names another address', async () => {
    const { client, seen } = build({ world: { authorized: true, state: standingState(COMMITTED, 1n, 10) } });
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT, undefined, { from: SENDER })) as PreparedCall;

    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(prepared.simulation).toEqual({ success: true });
  });

  it.each([
    ['prepareCommitSetup', (client: ReturnType<typeof build>['client']) => client.prepareCommitSetup(EMPTY_DRAFT, undefined, { from: 'garbage' as Address })],
    ['prepareClearSetup', (client: ReturnType<typeof build>['client']) => client.prepareClearSetup({ from: 'garbage' as Address })],
  ])('refuses a malformed options.from on %s with a TypeError before any read', async (_name, call) => {
    const { client, seen } = build();

    await expect(call(client)).rejects.toThrow(TypeError);
    expect(seen.provider).toEqual([]);
  });

  it('skips the simulation where options.simulate is false', async () => {
    const { client, seen } = build();
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT, undefined, { simulate: false })) as PreparedBatch;

    expect(seen.calls).toEqual([]);
    expect(prepared.calls.every((call) => !('simulation' in call) || call.simulation === undefined)).toBe(true);
  });

  it('skips the simulation where no option is passed and the configuration default is false', async () => {
    const { client, seen } = build({ configuration: { simulate: false } });
    const prepared = await client.prepareClearSetup();

    expect(seen.calls).toEqual([]);
    expect(prepared.kind === 'call' ? prepared.simulation : undefined).toBeUndefined();
  });

  it('simulates where options.simulate is true over a configuration default of false', async () => {
    const { client, seen } = build({ configuration: { simulate: false } });

    await client.prepareClearSetup({ simulate: true });

    expect(seen.calls).toHaveLength(1);
  });

  it.each([
    ['an unknown custom error', UNKNOWN_REVERT],
    ['Error(string)', STRING_REVERT],
  ])('returns a reverted call (%s) as a typed failure and still returns the prepare', async (_name, data) => {
    const { client } = build({
      world: { simulate: async (_to, _data, _from, index) => (index === 1 ? Promise.reject(revert(data)) : '0x') },
    });
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT)) as PreparedBatch;

    expect(prepared.calls[0]?.simulation).toEqual({ success: true });

    const failed = prepared.calls[1]?.simulation;

    expect(failed?.success).toBe(false);
    expect(failed).toEqual({ success: false, from: expect.any(String), error: decodeRevert(data) });
    expect(failed?.success === false ? failed.from.toLowerCase() : '').toBe(ACCOUNT.toLowerCase());
  });

  it('keeps simulating the second call after the first reverts', async () => {
    const { client, seen } = build({
      world: { simulate: async (_to, _data, _from, index) => (index === 0 ? Promise.reject(revert(UNKNOWN_REVERT)) : '0x') },
    });
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT)) as PreparedBatch;

    expect(seen.calls).toHaveLength(2);
    expect(prepared.calls[0]?.simulation?.success).toBe(false);
    expect(prepared.calls[1]?.simulation).toEqual({ success: true });
  });

  it('rejects the prepare with the transport failure itself, not a typed failure', async () => {
    const failure = transportFailure();
    const { client } = build({ world: { simulate: async () => Promise.reject(failure) } });

    await expect(client.prepareCommitSetup(EMPTY_DRAFT)).rejects.toBe(failure);
  });

  it('rejects the clear prepare with a transport failure during its simulation', async () => {
    const failure = transportFailure();
    const { client } = build({ world: { simulate: async () => Promise.reject(failure) } });

    await expect(client.prepareClearSetup()).rejects.toBe(failure);
  });
});
