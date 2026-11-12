import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { referenceAssociatedData, referenceSeal } from '../encryption/reference';
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
let sealedUnderOtherAccount: Hex;
let sealedUnderOtherAction: Hex;

/** `AUTHENTICATED` under the legacy payload version 1. */
const LEGACY_AUTHENTICATED: BackupAuthenticated = { ...AUTHENTICATED, payloadVersion: 1 };
/** A version-1 payload of `CONFIGURATION`, sealed by the node:crypto reference over a zero-length salt. */
const LEGACY_SEALED = referenceSeal(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, LEGACY_AUTHENTICATED);

beforeAll(async () => {
  [sealed, sealedOther, sealedUnderOtherNonce, sealedUnderOtherCommitment, sealedUnderOtherAccount, sealedUnderOtherAction] = await Promise.all([
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED),
    sealBackup(OTHER, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, nonce: NONCE - 1n }),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, setupCommitment: `0x${'cd'.repeat(32)}` }),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, account: METHOD_A }),
    sealBackup(CONFIGURATION, PASSWORD, SEAL_NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, action: METHOD_A }),
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

  it('refuses backup-unopened for a payload sealed under another account', async () => {
    expect(await causeOf(restoreFrom(sealedUnderOtherAccount))).toStrictEqual(unopened);
  }, SLOW);

  it('refuses backup-unopened for a payload sealed under another action', async () => {
    expect(await causeOf(restoreFrom(sealedUnderOtherAction))).toStrictEqual(unopened);
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

/** The PBKDF2 salt sizes `crypto.subtle.deriveKey` was handed, one per derivation. */
const saltSizes = (deriveKey: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): number[] =>
  deriveKey.mock.calls.map(([algorithm]) => ((algorithm as Pbkdf2Params).salt as ArrayBufferView).byteLength);

describe('restoreConfiguration tries version 2, then version 1', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a version-2 payload with one derivation, salted with the version-2 associated data', async () => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    await expect(restoreFrom(sealed)).resolves.toEqual(CONFIGURATION);
    expect(saltSizes(deriveKey)).toEqual([160]);

    const [algorithm] = deriveKey.mock.calls[0] ?? [];
    const salt = (algorithm as Pbkdf2Params).salt as ArrayBufferView;

    expect(Buffer.from(salt.buffer, salt.byteOffset, salt.byteLength).equals(referenceAssociatedData(AUTHENTICATED))).toBe(true);
  }, SLOW);

  it('opens a version-1 payload on the second attempt, deriving under the version-2 salt and then the empty one', async () => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    await expect(restoreFrom(LEGACY_SEALED)).resolves.toEqual(CONFIGURATION);
    expect(saltSizes(deriveKey)).toEqual([160, 0]);
  }, SLOW);

  it('opens a version-1 payload through a real EventManager reading the raw log', async () => {
    const { manager } = realEvents([setupCommittedLog(NONCE, COMMITMENT, LEGACY_SEALED, { blockNumber: 1_000 })]);

    await expect(
      restoreConfiguration(manager, ACCOUNT, ACTION, { password: PASSWORD }, actionState(COMMITMENT, NONCE, 1_000), { number: 1_200, hash: BLOCK.hash }),
    ).resolves.toEqual(CONFIGURATION);
  }, SLOW);

  it.each([
    ['a version-2 payload', () => sealed],
    ['a version-1 payload', () => LEGACY_SEALED],
  ])('refuses %s under a wrong password after exactly two derivations, reporting the version-2 values', async (_, payload) => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    expect(await causeOf(restoreFrom(payload(), 'wrong horse'))).toStrictEqual({
      code: 'restore.backup-unopened',
      subject: 'restore',
      values: { payloadSize: 2501, authenticated: { ...AUTHENTICATED, payloadVersion: 2 } },
    });
    expect(saltSizes(deriveKey)).toEqual([160, 0]);
  }, SLOW);

  it.each([
    ['2 bytes', '0x1234' as Hex, 2],
    ['2500 bytes', `0x${'00'.repeat(2500)}` as Hex, 2500],
    ['2502 bytes', `0x${'00'.repeat(2502)}` as Hex, 2502],
  ])('refuses a payload of %s with no derivation, reporting the version-2 values', async (_, payload, payloadSize) => {
    const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    expect(await causeOf(restoreFrom(payload))).toStrictEqual({
      code: 'restore.backup-unopened',
      subject: 'restore',
      values: { payloadSize, authenticated: { ...AUTHENTICATED, payloadVersion: 2 } },
    });
    expect(importKey).not.toHaveBeenCalled();
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it.each([
    ['a TypeError', new TypeError('derivation refused')],
    ['an Error', new Error('WebCrypto is unavailable')],
  ])('propagates %s raised in the first attempt as itself and never runs the second', async (_, failure) => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockRejectedValueOnce(failure);

    await expect(restoreFrom(sealed)).rejects.toBe(failure);
    expect(deriveKey).toHaveBeenCalledTimes(1);
  }, SLOW);
});
