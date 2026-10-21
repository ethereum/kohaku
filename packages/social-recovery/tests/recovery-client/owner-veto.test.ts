import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Address } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  attemptIn,
  callsTo,
  CLIENT_CONFIGURATION,
  errorCodes,
  HEADER,
  INJECTED,
  lastArg,
  MANAGER,
  METHOD_OTHER,
  METHOD_PASSKEY,
  pinnedOf,
  rejectionOf,
  rig,
  stateFor,
  world,
  ZERO,
} from './doubles';
import { cancelByOwnerData, cancelByVetoData } from './encodings';
import { membersOf } from './prepare-fixtures';

const SPONSOR = getAddress(`0x${'5b'.repeat(20)}`);
const waiting = () => world({ state: stateFor(undefined, attemptIn('Waiting', 11n)) });

describe('prepareCancelByOwner', () => {
  it('prepares cancelByOwner(action, the waiting attempt id) on the manager, sent by the account, value zero, at the pinned block', async () => {
    const built = rig(waiting());
    const prepared = await built.client.prepareCancelByOwner();

    expect(prepared.kind).toBe('call');
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('account');
    expect(prepared.value).toBe(0n);
    expect(prepared.data.toLowerCase()).toBe(cancelByOwnerData(ACTION, 11n).toLowerCase());
    expect(prepared.block).toEqual(pinnedOf(HEADER));
    expect(prepared.describes).toBeUndefined();
  });

  it('reads the state once at the pinned block, as the veto does, and passes the attempt id and the block to the part', async () => {
    const built = rig(waiting());

    await built.client.prepareCancelByOwner();

    expect(membersOf(built.seen)).toEqual(['provider.block', 'manager.stateOf', 'manager.prepareCancelByOwner']);
    expect(lastArg(callsTo(built.seen, 'manager', 'stateOf')[0]!)).toEqual(pinnedOf(HEADER));

    const [part] = callsTo(built.seen, 'manager', 'prepareCancelByOwner');

    expect(part?.args.slice(1)).toEqual([11n, pinnedOf(HEADER)]);
    expect(String(part?.args[0]).toLowerCase()).toBe(ACTION.toLowerCase());
  });

  it.each(['None', 'Cancelled', 'Consumed'] as const)(
    'refuses with request.no-active-attempt where the attempt is %s, before any simulation, preparing nothing',
    async (state) => {
      const built = rig(world({ state: stateFor(undefined, attemptIn(state, 7n)) }), { ...CLIENT_CONFIGURATION, simulate: true });
      const thrown = await rejectionOf(built.client.prepareCancelByOwner());

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect(errorCodes(thrown)).toEqual(['request.no-active-attempt']);
      expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
      expect(callsTo(built.seen, 'manager', 'prepareCancelByOwner')).toEqual([]);
      expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
    },
  );

  it('refuses where no attempt waits exactly as the veto does', async () => {
    const byAccount = await rejectionOf(rig(world({ state: stateFor(undefined, attemptIn('None', 0n)) })).client.prepareCancelByOwner());
    const byVeto = await rejectionOf(rig(world({ state: stateFor(undefined, attemptIn('None', 0n)) })).client.prepareCancelByVeto(METHOD_PASSKEY));

    expect(byAccount).toBeInstanceOf(KitRefusalError);
    expect((byAccount as Error).message).toBe((byVeto as Error).message);
    expect(errorCodes(byAccount)).toEqual(errorCodes(byVeto));
  });

  it('simulates from the account under a simulating configuration', async () => {
    const built = rig(waiting(), { ...CLIENT_CONFIGURATION, simulate: true });
    const prepared = await built.client.prepareCancelByOwner();

    expect(prepared.simulation).toEqual({ success: true });

    const [call] = callsTo(built.seen, 'provider', 'call');

    expect(String(call?.args[2]).toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(call?.args[3]).toBe(HEADER.number);
  });

  it('returns a revert of the simulation as a typed failure from the account', async () => {
    const built = rig(waiting(), { ...CLIENT_CONFIGURATION, simulate: true }, { call: async () => Promise.reject({ data: '0x12345678' }) });
    const prepared = await built.client.prepareCancelByOwner();

    expect(prepared.simulation?.success).toBe(false);
    expect((prepared.simulation as { from: string }).from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
  });

  it('makes no simulation call by the configuration default', async () => {
    const built = rig(waiting());
    const prepared = await built.client.prepareCancelByOwner();

    expect('simulation' in prepared).toBe(false);
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });

  it('rejects with a failing state read itself', async () => {
    const built = rig(world({ failures: new Map([['manager.stateOf', INJECTED]]) }));

    await expect(built.client.prepareCancelByOwner()).rejects.toBe(INJECTED);
    expect(callsTo(built.seen, 'manager', 'prepareCancelByOwner')).toEqual([]);
  });
});

describe('prepareCancelByVeto', () => {
  it('prepares cancelByVeto(account, action, live attempt id, method) on the manager, sent by anyone', async () => {
    const built = rig(waiting());
    const prepared = await built.client.prepareCancelByVeto(METHOD_PASSKEY);

    expect(prepared.kind).toBe('call');
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('anyone');
    expect(prepared.value).toBe(0n);
    expect(prepared.data.toLowerCase()).toBe(cancelByVetoData(ACCOUNT, ACTION, 11n, METHOD_PASSKEY).toLowerCase());
    expect(prepared.block).toEqual(pinnedOf(HEADER));
    expect(prepared.describes).toBeUndefined();
  });

  it('reads the state once at the pinned block and no pause', async () => {
    const built = rig(waiting());

    await built.client.prepareCancelByVeto(METHOD_PASSKEY);

    expect(membersOf(built.seen)).toEqual(['provider.block', 'manager.stateOf', 'manager.prepareCancelByVeto']);
    expect(lastArg(callsTo(built.seen, 'manager', 'stateOf')[0]!)).toEqual(pinnedOf(HEADER));
    expect(lastArg(callsTo(built.seen, 'manager', 'prepareCancelByVeto')[0]!)).toEqual(pinnedOf(HEADER));
  });

  it.each(['None', 'Cancelled', 'Consumed'] as const)(
    'refuses with request.no-active-attempt where the attempt is %s, preparing nothing',
    async (state) => {
      const built = rig(world({ state: stateFor(undefined, attemptIn(state, 7n)) }));
      const thrown = await rejectionOf(built.client.prepareCancelByVeto(METHOD_PASSKEY));

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect(errorCodes(thrown)).toEqual(['request.no-active-attempt']);
      expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
      expect(callsTo(built.seen, 'manager', 'prepareCancelByVeto')).toEqual([]);
    },
  );

  it('leaves an unused method, a stopped-or-not method and an ignoring attempt to the simulation', async () => {
    const attempt = { ...attemptIn('Waiting', 11n), ignoresPause: true, usedMethods: [METHOD_PASSKEY] };
    const built = rig(world({ state: stateFor(undefined, attempt) }));

    await expect(built.client.prepareCancelByVeto(METHOD_OTHER)).resolves.toBeDefined();
    expect(callsTo(built.seen, 'manager', 'paused')).toEqual([]);
  });

  it('simulates from options.from, else the zero address', async () => {
    const withFrom = rig(waiting());

    await withFrom.client.prepareCancelByVeto(METHOD_PASSKEY, { simulate: true, from: SPONSOR });
    expect(String(callsTo(withFrom.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(SPONSOR.toLowerCase());

    const without = rig(waiting());

    await without.client.prepareCancelByVeto(METHOD_PASSKEY, { simulate: true });
    expect(String(callsTo(without.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(ZERO);
  });

  it.each([
    ['undefined', undefined],
    ['a short address', '0x1234'],
    ['a number', 7],
    ['a bad checksum', '0xD1220a0cf47c7b9be7a2e6ba89f429762e7b9adb'],
  ] as const)('refuses a method that is %s before any provider call', async (_name, method) => {
    const built = rig(waiting());
    const thrown = await rejectionOf(built.client.prepareCancelByVeto(method as unknown as Address));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('refuses malformed options before any provider call', async () => {
    const built = rig(waiting());
    const thrown = await rejectionOf(built.client.prepareCancelByVeto(METHOD_PASSKEY, { from: '0x12' as Address }));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('rejects with a failing state read itself', async () => {
    const built = rig(world({ failures: new Map([['manager.stateOf', INJECTED]]) }));

    await expect(built.client.prepareCancelByVeto(METHOD_PASSKEY)).rejects.toBe(INJECTED);
  });
});
