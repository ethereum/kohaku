import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_FILTER,
  attemptIn,
  callsTo,
  CLIENT_CONFIGURATION,
  CONFIGURATION,
  GUARDIAN_A,
  GUARDIAN_B,
  HANDOVER,
  HEADER,
  KEY_NEW,
  KEY_OLD,
  lastArg,
  METHOD_ECDSA,
  METHOD_OTHER,
  METHOD_PASSKEY,
  ORDER,
  pinnedOf,
  rig,
  stateFor,
  world,
  type Seen,
} from './doubles';

const PINNED = pinnedOf(HEADER);
const WAITING = stateFor(CONFIGURATION, attemptIn('Waiting'));

const opening = () => {
  const built = rig();

  return { ...built, run: built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 }) };
};

const cancelling = () => {
  const built = rig(world({ state: WAITING }));

  return { ...built, run: built.client.initCancelGathering(CONFIGURATION, { window: 3_600 }) };
};

const lower = (values: readonly unknown[]): string[] => values.map((value) => String(value).toLowerCase()).sort();

const PART_MEMBERS = ['stateOf', 'paused', 'trustedParties', 'isAuthority', 'holdsAnyPrivilege'];

describe.each([
  ['initRecoveryGathering', opening],
  ['initCancelGathering', cancelling],
] as const)('%s pins one block', (_name, start) => {
  it('reads block once, at the configuration read tag', async () => {
    const { seen, run } = start();

    await run;
    expect(callsTo(seen, 'provider', 'block').map((one) => one.args)).toEqual([[CLIENT_CONFIGURATION.blockTags.read]]);
  });

  it('passes that block to every part read', async () => {
    const { seen, run } = start();

    await run;

    const partCalls = seen.filter((one) => (one.part === 'manager' || one.part === 'action') && PART_MEMBERS.includes(one.member));

    expect(partCalls.length).toBeGreaterThan(0);

    for (const one of partCalls) expect(lastArg(one)).toEqual(PINNED);
  });

  it('reads code at the pinned block number only', async () => {
    const { seen, run } = start();

    await run;

    const codes = callsTo(seen, 'provider', 'code');

    expect(codes.length).toBeGreaterThan(0);

    for (const one of codes) expect(one.args[1]).toBe(HEADER.number);
  });

  it('records the pinned header with its timestamp as a decimal string', async () => {
    const { run } = start();
    const record = await run;

    expect(record.request.block).toEqual({ number: HEADER.number, timestamp: String(HEADER.timestamp), hash: HEADER.hash });
  });

  it('reads stateOf once', async () => {
    const { seen, run } = start();

    await run;
    expect(callsTo(seen, 'manager', 'stateOf')).toHaveLength(1);
  });

  it('reads paused and trustedParties once per distinct rule method', async () => {
    const { seen, run } = start();

    await run;

    const methods = lower([METHOD_ECDSA, METHOD_PASSKEY, METHOD_OTHER]);

    expect(lower(callsTo(seen, 'manager', 'paused').map((one) => one.args[0]))).toEqual(methods);
    expect(lower(callsTo(seen, 'manager', 'trustedParties').map((one) => one.args[0]))).toEqual(methods);
  });

  it('reads code once per distinct wallet guardian address, never for another method', async () => {
    const { seen, run } = start();

    await run;
    expect(lower(callsTo(seen, 'provider', 'code').map((one) => one.args[0]))).toEqual(lower([GUARDIAN_A, GUARDIAN_B]));
  });

  it('makes no eth_call, no log read and no other part read of its own', async () => {
    const { seen, run } = start();

    await run;
    expect(callsTo(seen, 'provider', 'call')).toEqual([]);
    expect(callsTo(seen, 'provider', 'logs')).toEqual([]);
    expect(callsTo(seen, 'provider', 'chainId')).toEqual([]);

    const allowed = new Set(['provider.block', 'provider.code', ...PART_MEMBERS.map((member) => `manager.${member}`), 'action.isAuthority', 'action.holdsAnyPrivilege']);
    const others = seen.filter((one: Seen) => !allowed.has(`${one.part}.${one.member}`));

    expect(others.map((one) => `${one.part}.${one.member}`)).toEqual([]);
  });

  it('fetches no event for a configuration source', async () => {
    const { seen, run } = start();

    await run;
    expect(callsTo(seen, 'events', 'fetch')).toEqual([]);
  });
});

describe('the handover reads', () => {
  it('the opening init asks isAuthority of the removed key and holdsAnyPrivilege of the new key, at the pinned block', async () => {
    const { seen, run } = opening();

    await run;

    const authority = callsTo(seen, 'action', 'isAuthority');
    const privilege = callsTo(seen, 'action', 'holdsAnyPrivilege');

    expect(authority.length).toBeGreaterThanOrEqual(1);

    for (const one of authority) expect(String(one.args[0]).toLowerCase()).toBe(KEY_OLD.toLowerCase());

    expect(privilege.map((one) => String(one.args[0]).toLowerCase())).toEqual([KEY_NEW.toLowerCase()]);
  });

  it('the cancel init reads neither', async () => {
    const { seen, run } = cancelling();

    await run;
    expect(callsTo(seen, 'action', 'isAuthority')).toEqual([]);
    expect(callsTo(seen, 'action', 'holdsAnyPrivilege')).toEqual([]);
  });

  it('the inference over events reads up to the pinned block number', async () => {
    const built = rig(world({ notifications: [] }));

    await expect(built.client.initRecoveryGathering(CONFIGURATION, { newAuthority: KEY_NEW }, ORDER, { window: 3_600 })).rejects.toThrow();

    for (const one of callsTo(built.seen, 'events', 'fetch')) {
      expect(one.args[0]).toBe(ACCOUNT_FILTER);
      expect((one.args[1] as { to: number }).to).toBe(HEADER.number);
    }
  });
});
