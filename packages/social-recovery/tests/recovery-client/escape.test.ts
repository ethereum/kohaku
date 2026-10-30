import { describe, expect, it } from 'vitest';
import { KitRefusalError, SETUP_CLIENT_VERSION_ESCAPED_MESSAGE, type PreparedCall } from '../../src/index';
import { PINNED_AT } from '../gathering/support';
import { approvalWith } from './completion-fixtures';
import {
  attemptIn,
  CLIENT_CONFIGURATION,
  CONFIGURATION,
  HANDOVER,
  HEADER,
  METHOD_PASSKEY,
  ORDER,
  rejectionOf,
  rig,
  stateFor,
  world,
  type Rig,
} from './doubles';
import { boundAttempt, boundCancel, liveAttempt, membersOf, PAYLOAD } from './prepare-fixtures';

const PREPARES: readonly [string, (client: Rig['client']) => Promise<PreparedCall>][] = [
  ['prepareStartAttempt', (client) => client.prepareStartAttempt(boundAttempt(), HEADER.timestamp)],
  ['prepareCancelByProofs', (client) => client.prepareCancelByProofs(boundCancel(), HEADER.timestamp)],
  ['prepareCancelByOwner', (client) => client.prepareCancelByOwner()],
  ['prepareCancelByVeto', (client) => client.prepareCancelByVeto(METHOD_PASSKEY)],
  ['prepareExecuteHandover', (client) => client.prepareExecuteHandover(liveAttempt(), PAYLOAD)],
];

const live = () => world({ state: stateFor(undefined, liveAttempt()) });

describe('the version escape', () => {
  it.each(PREPARES)('%s throws a KitRefusalError while the flag is set, preparing and simulating nothing', async (_name, run) => {
    const built = rig(live(), { ...CLIENT_CONFIGURATION, simulate: true }, { escaped: true });
    const thrown = await rejectionOf(run(built.client));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_VERSION_ESCAPED_MESSAGE);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
    expect(membersOf(built.seen).filter((member) => member.startsWith('manager.prepare') || member === 'provider.call')).toEqual([]);
  });

  it.each(PREPARES)('%s prepares as usual with the flag explicitly false', async (_name, run) => {
    await expect(run(rig(live(), CLIENT_CONFIGURATION, { escaped: false }).client)).resolves.toBeDefined();
  });

  it('leaves the opening init working', async () => {
    const { client } = rig(world({ state: stateFor(undefined, attemptIn('None')) }), CLIENT_CONFIGURATION, { escaped: true });

    await expect(client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 })).resolves.toBeDefined();
  });

  it('leaves the cancel init working', async () => {
    const { client } = rig(world({ state: stateFor(undefined, attemptIn('Waiting', 9n)) }), CLIENT_CONFIGURATION, { escaped: true });

    await expect(client.initCancelGathering(CONFIGURATION, { window: 3_600 })).resolves.toBeDefined();
  });

  it('leaves the gathering members and the state record working', async () => {
    const { client } = rig(live(), CLIENT_CONFIGURATION, { escaped: true });
    const record = approvalWith([0, 1, 2]);

    expect(client.getApproverRequests(record)).toHaveLength(4);
    expect(client.assess(record, PINNED_AT).ruleSatisfied).toBe(true);
    expect(client.complete(record, undefined, PINNED_AT).proofs).toHaveLength(3);
    await expect(client.recoveryState()).resolves.toBeDefined();
  });
});
