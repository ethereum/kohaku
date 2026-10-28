import { beforeAll, describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  KitRefusalError,
  restoreConfiguration,
  sealBackup,
  type BackupAuthenticated,
  type Configuration,
  type Hex,
} from '../../src/index';
import { realEvents, setupCommittedLog } from './event-manager';
import {
  ACCOUNT,
  ACTION,
  actionState,
  BLOCK,
  committed,
  CONFIGURATION,
  eventsDouble,
  METHOD_A,
  referenceConfigurationCommitment,
} from './support';

const SLOW = 120_000;
const PASSWORD = 'correct horse battery staple';
const NONCE = 7n;
const COMMITMENT = referenceConfigurationCommitment(CONFIGURATION, ACCOUNT, ACTION, NONCE);
const STATE = actionState(COMMITMENT, NONCE, 100);
const SEAL_NONCE: Hex = '0x000102030405060708090a0b';

const AUTHENTICATED: BackupAuthenticated = {
  account: ACCOUNT,
  action: ACTION,
  setupCommitment: COMMITMENT,
  nonce: NONCE,
  payloadVersion: BACKUP_PAYLOAD_VERSION,
};

/** A configuration that does not recompute to `COMMITMENT`. */
const OTHER: Configuration = { clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: '0x99' }] }], wait: 60, ignoresPause: true };

let sealed: Hex;
let sealedOther: Hex;
let sealedUnderOtherNonce: Hex;
let sealedUnderOtherCommitment: Hex;

beforeAll(async () => {
  [sealed, sealedOther, sealedUnderOtherNonce, sealedUnderOtherCommitment] = await Promise.all([
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED),
    sealBackup(OTHER, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, nonce: NONCE - 1n }),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, setupCommitment: `0x${'cd'.repeat(32)}` }),
  ]);
}, SLOW);

const restoreFrom = (payload: Hex, password = PASSWORD) =>
  restoreConfiguration(eventsDouble([committed(NONCE, COMMITMENT, payload)]).events, ACCOUNT, ACTION, { password }, STATE, BLOCK);

async function causeOf(promise: Promise<unknown>): Promise<unknown> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(thrown).toBeInstanceOf(KitRefusalError);
  expect((thrown as KitRefusalError).cause).toBeUndefined();

  return (thrown as KitRefusalError).restoreCause;
}

const unopened = { code: 'restore.backup-unopened', subject: 'restore', values: { payloadSize: 2501, authenticated: AUTHENTICATED } };

describe('restoreConfiguration over a sealed backup', () => {
  it('opens a payload sealed under the five values and returns the configuration', async () => {
    expect((sealed.length - 2) / 2).toBe(2501);
    await expect(restoreFrom(sealed)).resolves.toEqual(CONFIGURATION);
  }, SLOW);

  it('refuses backup-unopened under a wrong password', async () => {
    expect(await causeOf(restoreFrom(sealed, 'wrong horse'))).toStrictEqual(unopened);
  }, SLOW);

  it('refuses backup-unopened when one byte of the payload is flipped', async () => {
    const last = Number.parseInt(sealed.slice(-2), 16) ^ 0x01;
    const flipped = `${sealed.slice(0, -2)}${last.toString(16).padStart(2, '0')}` as Hex;

    expect(await causeOf(restoreFrom(flipped))).toStrictEqual(unopened);
  }, SLOW);

  it('refuses backup-unopened for a payload sealed under another setup nonce', async () => {
    expect(await causeOf(restoreFrom(sealedUnderOtherNonce))).toStrictEqual(unopened);
  }, SLOW);

  it('refuses backup-unopened for a payload sealed under another commitment', async () => {
    expect(await causeOf(restoreFrom(sealedUnderOtherCommitment))).toStrictEqual(unopened);
  }, SLOW);

  it('refuses commitment-mismatch when what opened does not recompute', async () => {
    expect(await causeOf(restoreFrom(sealedOther))).toStrictEqual({
      code: 'restore.commitment-mismatch',
      subject: 'restore',
      values: { recomputed: referenceConfigurationCommitment(OTHER, ACCOUNT, ACTION, NONCE), committed: COMMITMENT },
    });
  }, SLOW);

  it('opens through a real EventManager reading the raw log', async () => {
    const pinned = { number: 1_200, hash: BLOCK.hash };
    const { manager } = realEvents([setupCommittedLog(NONCE, COMMITMENT, sealed, { blockNumber: 1_000 })]);

    await expect(
      restoreConfiguration(manager, ACCOUNT, ACTION, { password: PASSWORD }, actionState(COMMITMENT, NONCE, 1_000), pinned),
    ).resolves.toEqual(CONFIGURATION);
  }, SLOW);
});
