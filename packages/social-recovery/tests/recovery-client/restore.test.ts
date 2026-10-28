import { beforeAll, describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  KitRefusalError,
  sealBackup,
  type ActionState,
  type Hex,
  type KitNotification,
} from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_FILTER,
  ACTION,
  attemptIn,
  callsTo,
  commitmentOf,
  CONFIGURATION,
  HANDOVER,
  HEADER,
  ORDER,
  rejectionOf,
  rig,
  SETUP_NONCE,
  stateFor,
  world,
  type World,
} from './doubles';

const SLOW = 120_000;
const PASSWORD = 'correct horse battery staple';
const COMMITMENT = commitmentOf(CONFIGURATION, SETUP_NONCE);
const STATE = stateFor();
const AUTHENTICATED = { account: ACCOUNT, action: ACTION, setupCommitment: COMMITMENT, nonce: SETUP_NONCE, payloadVersion: BACKUP_PAYLOAD_VERSION };

let sealed: Hex;

beforeAll(async () => {
  sealed = await sealBackup(CONFIGURATION, PASSWORD, '0x000102030405060708090a0b', BACKUP_PADDING_SIZE, AUTHENTICATED);
}, SLOW);

const committed = (nonce: bigint, setupCommitment: Hex, privateMetadata: Hex, block = 1_000, index = 0): KitNotification => ({
  kind: 'setup-committed',
  account: ACCOUNT,
  action: ACTION,
  nonce,
  setupCommitment,
  publicMetadata: '0x',
  privateMetadata,
  at: {
    blockNumber: block,
    blockHash: `0x${block.toString(16).padStart(64, '0')}`,
    logIndex: index,
    transactionHash: `0x${(block * 1000 + index).toString(16).padStart(64, '0')}`,
    removed: false,
  },
});

const open = (overrides: Partial<World>, password = PASSWORD) => {
  const built = rig(world(overrides));

  return { ...built, run: built.client.initRecoveryGathering({ password }, HANDOVER, ORDER, { window: 3_600 }) };
};

const cancel = (overrides: Partial<World>, state: ActionState = stateFor(CONFIGURATION, attemptIn('Waiting'))) => {
  const built = rig(world({ state, ...overrides }));

  return { ...built, run: built.client.initCancelGathering({ password: PASSWORD }, { window: 3_600 }) };
};

describe('a password source', () => {
  it('opens the backup and builds the record of the restored configuration, which keeps no labels', { timeout: SLOW }, async () => {
    const built = open({ notifications: [committed(SETUP_NONCE, COMMITMENT, sealed)] });
    const record = await built.run;

    expect(record.places.map((entry) => entry.salt.toLowerCase())[1]).toBe(`0x${'aa'.repeat(32)}`);
    expect(record.places.map((entry) => entry.label)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('fetches the setup events exactly once, from setupCommittedAtBlock to the pinned block', { timeout: SLOW }, async () => {
    const built = open({ notifications: [committed(SETUP_NONCE, COMMITMENT, sealed)] });

    await built.run;

    const fetches = callsTo(built.seen, 'events', 'fetch');

    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.args).toEqual([ACCOUNT_FILTER, { from: STATE.setupCommittedAtBlock, to: HEADER.number }]);
  });

  it('the cancel init restores the same way', { timeout: SLOW }, async () => {
    const built = cancel({ notifications: [committed(SETUP_NONCE, COMMITMENT, sealed)] });

    await expect(built.run).resolves.toMatchObject({ purpose: 'cancellation' });
    expect(callsTo(built.seen, 'events', 'fetch')).toHaveLength(1);
  });

  it('a wrong password refuses with restore.backup-unopened', { timeout: SLOW }, async () => {
    const thrown = await rejectionOf(open({ notifications: [committed(SETUP_NONCE, COMMITMENT, sealed)] }, 'wrong password').run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).restoreCause?.code).toBe('restore.backup-unopened');
  });

  it('no setup event in range refuses with restore.no-backup, case no-backup-kept', async () => {
    const thrown = await rejectionOf(open({ notifications: [] }).run);

    expect((thrown as KitRefusalError).restoreCause).toMatchObject({ code: 'restore.no-backup', values: { case: 'no-backup-kept' } });
  });

  it('a stale highest event, its nonce behind stateOf, refuses with no-backup-kept', async () => {
    const thrown = await rejectionOf(open({ notifications: [committed(SETUP_NONCE - 1n, COMMITMENT, sealed)] }).run);

    expect((thrown as KitRefusalError).restoreCause).toMatchObject({ code: 'restore.no-backup', values: { case: 'no-backup-kept' } });
  });

  it('a highest event whose commitment differs from stateOf refuses with no-backup-kept', async () => {
    const thrown = await rejectionOf(open({ notifications: [committed(SETUP_NONCE, `0x${'cd'.repeat(32)}`, sealed)] }).run);

    expect((thrown as KitRefusalError).restoreCause).toMatchObject({ code: 'restore.no-backup', values: { case: 'no-backup-kept' } });
  });

  it('a transport failure of the fetch propagates as itself', async () => {
    const failure = new Error('logs down');
    const thrown = await rejectionOf(open({ failures: new Map([['events.fetch', failure]]) }).run);

    expect(thrown).toBe(failure);
  });

  it('no setup standing refuses with case no-setup and fetches nothing', async () => {
    const built = open({ state: { ...STATE, setupCommitment: `0x${'00'.repeat(32)}` } });
    const thrown = await rejectionOf(built.run);

    expect((thrown as KitRefusalError).restoreCause).toMatchObject({ code: 'restore.no-backup', values: { case: 'no-setup' } });
    expect(callsTo(built.seen, 'events', 'fetch')).toEqual([]);
  });
});
