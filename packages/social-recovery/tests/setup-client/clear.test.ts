import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, POLICY_MANAGER_WRITES_ABI, type PreparedBatch, type PreparedCall } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  build,
  clearSetupData,
  COMMITTED,
  DISARMING_DATA,
  members,
  noSetupState,
  PIN,
  standingState,
} from './doubles';

describe('prepareClearSetup: three shapes from hasSetup and isAuthorized', () => {
  it('returns an atomic batch of clearSetup and the disarming call where a setup stands on an armed account', async () => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 3n, 900), authorized: true } });
    const prepared = (await client.prepareClearSetup()) as PreparedBatch;

    expect(prepared.kind).toBe('batch');
    expect(prepared.atomic).toBe(true);
    expect(prepared.block).toEqual(PIN);
    expect(prepared.calls.map((call) => call.data).sort()).toEqual([clearSetupData(ACTION, 3n), DISARMING_DATA].sort());

    for (const call of prepared.calls) {
      expect(call.block).toEqual(PIN);
      expect(call.sender).toBe('account');
      expect(call.simulation).toEqual({ success: true });
    }

    expect(seen.calls).toHaveLength(2);
  });

  it('returns clearSetup alone where a setup stands and the account does not authorize the action', async () => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 3n, 900), authorized: false } });
    const prepared = (await client.prepareClearSetup()) as PreparedCall;

    expect(prepared.kind).toBe('call');
    expect(prepared.data).toBe(clearSetupData(ACTION, 3n));
    expect(decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: prepared.data }).functionName).toBe('clearSetup');
    expect(prepared.block).toEqual(PIN);
    expect(members(seen)).not.toContain('action.disarmingCall');
  });

  it.each([true, false])('returns the disarming call alone where no setup stands (authorized %s), simulated', async (authorized) => {
    const { client, seen } = build({ world: { state: noSetupState(5n, 700), authorized } });
    const prepared = (await client.prepareClearSetup()) as PreparedCall;

    expect(prepared.kind).toBe('call');
    expect(prepared.data).toBe(DISARMING_DATA);
    expect(prepared.block).toEqual(PIN);
    expect(prepared.simulation).toEqual({ success: true });
    expect(members(seen)).not.toContain('manager.prepareClearSetup');
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
  });

  it('reads hasSetup from a non-zero commitment even when the stored nonce is zero', async () => {
    const { client } = build({ world: { state: standingState(COMMITTED, 0n, 0), authorized: false } });
    const prepared = (await client.prepareClearSetup()) as PreparedCall;

    expect(prepared.data).toBe(clearSetupData(ACTION, 0n));
  });

  it('reads no setup over a zero commitment after a clear bumped the nonce', async () => {
    const { client } = build({ world: { state: noSetupState(9n, 800), authorized: false } });
    const prepared = (await client.prepareClearSetup()) as PreparedCall;

    expect(prepared.data).toBe(DISARMING_DATA);
  });

  it('pins one block and passes it to every part call', async () => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 3n, 900), authorized: true } });

    await client.prepareClearSetup();

    expect(seen.blockTags).toEqual(['latest']);
    expect(members(seen)).toEqual(expect.arrayContaining(['manager.stateOf', 'action.isAuthorized']));

    for (const call of seen.parts) {
      expect(call.args[call.args.length - 1], `${call.part}.${call.member}`).toEqual(PIN);
    }
  });

  it('reads a code-less account as unauthorized without calling isAuthorized', async () => {
    const { client, seen } = build({
      world: { code: '0x', state: standingState(COMMITTED, 3n, 900), authorized: { rejects: { data: '0x' } } },
    });
    const prepared = (await client.prepareClearSetup()) as PreparedCall;

    expect(prepared.data).toBe(clearSetupData(ACTION, 3n));
    expect(members(seen)).not.toContain('action.isAuthorized');
  });

  it.each([true, false])('names the stored setup nonce the state read answers (authorized %s): clearSetup(action, 7)', async (authorized) => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 7n, 900), authorized } });
    const prepared = await client.prepareClearSetup();
    const calls = prepared.kind === 'batch' ? prepared.calls : [prepared];
    const clear = calls.find((call) => call.data.slice(0, 10) === clearSetupData(ACTION, 0n).slice(0, 10));

    expect(clear?.data).toBe(clearSetupData(ACTION, 7n));
    expect(decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: clear?.data ?? '0x' }).args).toEqual([ACTION, 7n]);
    expect(seen.parts.filter((call) => call.member === 'prepareClearSetup').map((call) => call.args)).toEqual([[ACTION, 7n, PIN]]);
    expect(members(seen).indexOf('manager.stateOf')).toBeLessThan(members(seen).indexOf('manager.prepareClearSetup'));
  });

  it('throws while the version escape is set', async () => {
    const { client, seen } = build({ escaped: true, world: { state: standingState(COMMITTED, 3n, 900), authorized: true } });

    await expect(client.prepareClearSetup()).rejects.toThrow(KitRefusalError);
    expect(members(seen)).not.toContain('manager.prepareClearSetup');
    expect(members(seen)).not.toContain('action.disarmingCall');
  });

  it('rejects with a transport failure of stateOf as itself', async () => {
    const failure = new Error('socket hang up');
    const { client } = build({ world: { state: { rejects: failure } } });

    await expect(client.prepareClearSetup()).rejects.toBe(failure);
  });
});
