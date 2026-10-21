import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_ADDRESS_SIZE,
  BACKUP_BYTE_BITS,
  BACKUP_CLAUSE_HEADER_SIZE,
  BACKUP_COUNT_SIZE,
  BACKUP_CREDENTIAL_COUNT,
  BACKUP_CREDENTIAL_FIXED_SIZE,
  BACKUP_FLAG_SIZE,
  BACKUP_HEADER_SIZE,
  BACKUP_KDF_HASH,
  BACKUP_KDF_ITERATIONS,
  BACKUP_KEY_BITS,
  BACKUP_LENGTH_SIZE,
  BACKUP_NONCE_SIZE,
  BACKUP_PADDING_SIZE,
  BACKUP_SALT_SIZE,
  BACKUP_SEALED_PAYLOAD_SIZE,
  BACKUP_TAG_SIZE,
  BACKUP_THRESHOLD_SIZE,
  BACKUP_UINT16_BITS,
  BACKUP_WAIT_SIZE,
  BACKUP_WIDEST_CONFIG_SIZE,
  FORMATS_THRESHOLD_BITS,
  FORMATS_WAIT_BITS,
  BackupUnopenedError,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Hex,
} from '../../src/index';
import {
  pbkdf2Key,
  referenceAssociatedData,
  referenceKey,
  referenceOpenRaw,
  referencePlaintext,
  referenceSeal,
  referenceSealRaw,
  referenceSerialize,
  referenceSize,
  toBytes,
  toHex,
} from './reference';
import {
  AUTHENTICATED,
  byteLength,
  expectedOpened,
  MIXED_RULE,
  NONCE,
  passkeyClausesRule,
  passkeyRule,
  PASSWORD,
} from './samples';

const TIMEOUT = 60_000;
const UNICODE_PASSWORD = 'pässwörd 🔑 密码';

describe('the sealed payload against node:crypto', () => {
  it('opens under node PBKDF2-HMAC-SHA256 600k and AES-256-GCM to the documented plaintext', async () => {
    const payload = toBytes(await sealBackup(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const plaintext = referenceOpenRaw(referenceKey(UNICODE_PASSWORD), payload, associatedData);

    expect(associatedData.length).toBe(160);
    expect(payload.length).toBe(12 + BACKUP_PADDING_SIZE + 16);
    expect(toHex(payload.subarray(0, 12))).toBe(NONCE);
    expect(plaintext.length).toBe(BACKUP_PADDING_SIZE);
    expect(toHex(plaintext)).toBe(toHex(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)));
    expect(serializeConfiguration(MIXED_RULE)).toBe(toHex(referenceSerialize(MIXED_RULE)));
  }, TIMEOUT);

  it('matches a node:crypto seal byte for byte, and openBackup opens the node seal', async () => {
    const reference = referenceSeal(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);
    const shipped = await sealBackup(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);
    const opened = await openBackup(reference, UNICODE_PASSWORD, AUTHENTICATED);

    expect(shipped).toBe(reference);
    expect(serializeConfiguration(opened)).toBe(toHex(referenceSerialize(MIXED_RULE)));
  }, TIMEOUT);

  it('does not open under a key node derives with any other iteration count', async () => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const plaintext = referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE);
    // the same empty salt as the scheme, so only the iteration count differs
    const weakKey = pbkdf2Key(UNICODE_PASSWORD, Buffer.alloc(0), 599_999);
    const forged = toHex(referenceSealRaw(weakKey, toBytes(NONCE), associatedData, plaintext));
    const genuine = toHex(referenceSealRaw(referenceKey(UNICODE_PASSWORD), toBytes(NONCE), associatedData, plaintext));

    await expect(openBackup(forged, UNICODE_PASSWORD, AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
    await expect(openBackup(genuine, UNICODE_PASSWORD, AUTHENTICATED)).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);

  it('encodes the version as a word of the associated data, so a node seal under version 2 opens only under 2', async () => {
    const other = { ...AUTHENTICATED, payloadVersion: 2 };
    const sealed = referenceSeal(MIXED_RULE, 'pw', NONCE, BACKUP_PADDING_SIZE, other);

    await expect(openBackup(sealed, 'pw', other)).resolves.toBeDefined();
    await expect(openBackup(sealed, 'pw', AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);
});

/** A second setup whose five authenticated values all differ from `AUTHENTICATED`. */
const OTHER_SETUP: BackupAuthenticated = {
  account: '0x4444444444444444444444444444444444444444',
  action: '0x5555555555555555555555555555555555555555',
  setupCommitment: `0x${'c7'.repeat(32)}`,
  nonce: 2n ** 64n - 1n,
  payloadVersion: 2,
};

const ONE_AT_A_TIME: ReadonlyArray<readonly [string, BackupAuthenticated]> = [
  ['account', { ...AUTHENTICATED, account: OTHER_SETUP.account }],
  ['action', { ...AUTHENTICATED, action: OTHER_SETUP.action }],
  ['setup commitment', { ...AUTHENTICATED, setupCommitment: OTHER_SETUP.setupCommitment }],
  ['setup nonce', { ...AUTHENTICATED, nonce: OTHER_SETUP.nonce }],
  ['payload version', { ...AUTHENTICATED, payloadVersion: OTHER_SETUP.payloadVersion }],
];

describe('the key is PBKDF2 over the password alone, with a zero-length salt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not open under the former key, PBKDF2 with the 160-byte associated data as the salt', async () => {
    const payload = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const formerKey = pbkdf2Key(PASSWORD, associatedData, 600_000);
    const formerSeal = toHex(referenceSealRaw(formerKey, toBytes(NONCE), associatedData, referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)));

    expect(associatedData.length).toBe(160);
    expect(formerKey.equals(referenceKey(PASSWORD))).toBe(false);
    expect(() => referenceOpenRaw(formerKey, payload, associatedData)).toThrow();
    await expect(openBackup(formerSeal, PASSWORD, AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);

  it('hands crypto.subtle.deriveKey a zero-length salt and 600,000 iterations for two different authenticated sets', async () => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);
    await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP);

    const params = deriveKey.mock.calls.map(([algorithm]) => algorithm as Pbkdf2Params);

    expect(params).toHaveLength(2);

    for (const { salt, iterations } of params) {
      expect((salt as ArrayBuffer | ArrayBufferView).byteLength).toBe(0);
      expect(iterations).toBe(600_000);
    }
  }, TIMEOUT);

  it('opens payloads sealed for two different setups with one node key, each under its own associated data only', async () => {
    const key = referenceKey(PASSWORD);
    const plaintext = referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE);
    const sealFor = async (authenticated: BackupAuthenticated): Promise<Buffer> =>
      toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, authenticated));
    const [first, second] = await Promise.all([sealFor(AUTHENTICATED), sealFor(OTHER_SETUP)]);
    const firstData = referenceAssociatedData(AUTHENTICATED);
    const secondData = referenceAssociatedData(OTHER_SETUP);

    expect(referenceOpenRaw(key, first, firstData).equals(plaintext)).toBe(true);
    expect(referenceOpenRaw(key, second, secondData).equals(plaintext)).toBe(true);
    expect(() => referenceOpenRaw(key, first, secondData)).toThrow();
    expect(() => referenceOpenRaw(key, second, firstData)).toThrow();
  }, TIMEOUT);

  it('shares one keystream across setups under one password, so a nonce must never repeat under that password', async () => {
    const other = passkeyRule(3, true);
    const first = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const second = toBytes(await sealBackup(other, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP));
    const body = (payload: Buffer): Buffer => payload.subarray(12, 12 + BACKUP_PADDING_SIZE);
    const xor = (left: Buffer, right: Buffer): Buffer => Buffer.from(left.map((byte, index) => byte ^ (right[index] ?? 0)));

    expect(xor(body(first), body(second)).equals(
      xor(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE), referencePlaintext(other, BACKUP_PADDING_SIZE)),
    )).toBe(true);
  }, TIMEOUT);

  it('opens a node seal through openBackup under its own five values', async () => {
    const sealed = referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP);

    await expect(openBackup(sealed, PASSWORD, OTHER_SETUP)).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);

  it.for(ONE_AT_A_TIME)('still binds the %s: a node seal does not open when only that value differs', { timeout: TIMEOUT }, async ([, foreign]) => {
    const sealed = referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    await expect(openBackup(sealed, PASSWORD, foreign)).rejects.toBeInstanceOf(BackupUnopenedError);
  });
});

describe('authentic plaintexts the layout does not describe', () => {
  const sealRaw = (plaintext: Buffer): Hex => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);

    return toHex(referenceSealRaw(referenceKey('pw'), toBytes(NONCE), associatedData, plaintext));
  };

  it('opens the same node seal of the valid padded serialization, so the refusals below are not a key mismatch', async () => {
    await expect(
      openBackup(sealRaw(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)), 'pw', AUTHENTICATED),
    ).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);

  it('refuses a non-zero byte in the padding after a valid serialization', async () => {
    const plaintext = referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE);

    plaintext[plaintext.length - 1] = 1;

    await expect(openBackup(sealRaw(plaintext), 'pw', AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);

  it('refuses a plaintext of 0xff bytes (a salt flag of 0xff never parses)', async () => {
    await expect(
      openBackup(sealRaw(Buffer.alloc(BACKUP_PADDING_SIZE, 0xff)), 'pw', AUTHENTICATED),
    ).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);
});

describe('the password is its UTF-8 bytes, not normalized', () => {
  it('does not open a payload sealed under NFC "é" with the NFD spelling', async () => {
    const composed = 'café';
    const decomposed = 'café';
    const payload = await sealBackup(MIXED_RULE, composed, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC'));
    await expect(openBackup(payload, decomposed, AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);
});

describe('the padding arithmetic from the widths', () => {
  const SCHEME_CONFIG_WIDTHS = { wallet: 32, passkey: 96, zkPassport: 32, aadhaar: 32 } as const;
  const BLESSED_CONFIG_WIDTHS = { wallet: 32, passkey: 96, zkPassport: 256, aadhaar: 96 } as const;
  const widest = (widths: Record<string, number>): number => Math.max(...Object.values(widths));

  // The serialization's widths restated here rather than imported from src.
  const HEADER = { wait: 6, pauseFlag: 1, clauseCount: 2 } as const;
  const CLAUSE_HEADER = { threshold: 1, credentialCount: 2 } as const;
  const credentialWidths = (config: number) => ({ method: 20, configLength: 2, config, saltFlag: 1, salt: 32 }) as const;
  const sum = (widths: Record<string, number>): number => Object.values(widths).reduce((total, width) => total + width, 0);
  const clauseOfOne = (config: number): number => sum(CLAUSE_HEADER) + sum(credentialWidths(config));

  it('derives 2473 from the layout: 9 + 16 x (clause 3 + credential 151)', () => {
    const widestCredential = sum(credentialWidths(widest(SCHEME_CONFIG_WIDTHS)));

    expect(widest(SCHEME_CONFIG_WIDTHS)).toBe(96);
    expect(sum(HEADER)).toBe(9);
    expect(sum(CLAUSE_HEADER)).toBe(3);
    expect(widestCredential).toBe(151);
    expect(clauseOfOne(96)).toBe(154);
    expect(sum(HEADER) + BACKUP_CREDENTIAL_COUNT * clauseOfOne(96)).toBe(2473);
    expect(BACKUP_PADDING_SIZE).toBe(sum(HEADER) + BACKUP_CREDENTIAL_COUNT * clauseOfOne(BACKUP_WIDEST_CONFIG_SIZE));
    expect(BACKUP_PADDING_SIZE).toBe(2473);
    // the worst case is 16 one-credential clauses; one clause of 16 is smaller
    expect(sum(HEADER) + sum(CLAUSE_HEADER) + 16 * widestCredential).toBe(2428);
    expect(referenceSize(passkeyClausesRule(16))).toBe(BACKUP_PADDING_SIZE);
    // method, config and salt alone, without framing, fall 105 bytes short
    expect(16 * (96 + 32 + 20)).toBe(2368);
    expect(BACKUP_PADDING_SIZE - 16 * (96 + 32 + 20)).toBe(sum(HEADER) + 16 * (sum(CLAUSE_HEADER) + 2 + 1));
    expect(BACKUP_CREDENTIAL_COUNT).toBe(16);
    expect(BACKUP_WIDEST_CONFIG_SIZE).toBe(96);
    expect(BACKUP_SALT_SIZE).toBe(32);
    expect(BACKUP_ADDRESS_SIZE).toBe(credentialWidths(0).method);
    expect(BACKUP_NONCE_SIZE + BACKUP_PADDING_SIZE + BACKUP_TAG_SIZE).toBe(2501);
  });

  it('recomputes 2473 from the exported sizes, each field width derived from its bit width', () => {
    expect(BACKUP_WAIT_SIZE).toBe(FORMATS_WAIT_BITS / BACKUP_BYTE_BITS);
    expect(BACKUP_THRESHOLD_SIZE).toBe(FORMATS_THRESHOLD_BITS / BACKUP_BYTE_BITS);
    expect(BACKUP_COUNT_SIZE).toBe(BACKUP_UINT16_BITS / BACKUP_BYTE_BITS);
    expect(BACKUP_LENGTH_SIZE).toBe(BACKUP_UINT16_BITS / BACKUP_BYTE_BITS);
    expect(BACKUP_HEADER_SIZE).toBe(BACKUP_WAIT_SIZE + BACKUP_FLAG_SIZE + BACKUP_COUNT_SIZE);
    expect(BACKUP_HEADER_SIZE).toBe(sum(HEADER));
    expect(BACKUP_CLAUSE_HEADER_SIZE).toBe(sum(CLAUSE_HEADER));
    expect(BACKUP_CREDENTIAL_FIXED_SIZE).toBe(BACKUP_ADDRESS_SIZE + BACKUP_LENGTH_SIZE + BACKUP_FLAG_SIZE);
    expect(
      BACKUP_HEADER_SIZE +
        BACKUP_CREDENTIAL_COUNT *
          (BACKUP_CLAUSE_HEADER_SIZE + BACKUP_CREDENTIAL_FIXED_SIZE + BACKUP_WIDEST_CONFIG_SIZE + BACKUP_SALT_SIZE),
    ).toBe(2473);
    expect(BACKUP_SEALED_PAYLOAD_SIZE).toBe(2501);
  });

  it('pins the scheme numbers', () => {
    expect(BACKUP_KDF_ITERATIONS).toBe(600_000);
    expect(BACKUP_KDF_HASH).toBe('SHA-256');
    expect(BACKUP_KEY_BITS).toBe(256);
    expect(BACKUP_NONCE_SIZE * 8).toBe(96);
    expect(BACKUP_TAG_SIZE).toBe(16);
  });

  it('records that 16 salted passkeys fit, and only 7 salted or 8 unsalted fit at the blessed zkPassport width', () => {
    const inOneClause = passkeyRule(16, true);
    const inSixteenClauses = passkeyClausesRule(16);
    const perSaltedWidest = sum(credentialWidths(96));

    // 16 fit however they are grouped
    expect(referenceSize(inOneClause)).toBe(2428);
    expect(byteLength(serializeConfiguration(inOneClause))).toBe(2428);
    expect(referenceSize(inSixteenClauses)).toBe(2473);
    expect(byteLength(serializeConfiguration(inSixteenClauses))).toBe(2473);
    expect(Math.floor((BACKUP_PADDING_SIZE - sum(HEADER) - sum(CLAUSE_HEADER)) / perSaltedWidest)).toBe(16);
    expect(Math.floor((BACKUP_PADDING_SIZE - sum(HEADER)) / clauseOfOne(96))).toBe(16);

    // the blessed zkPassport config is 256 bytes
    const zkPassport = widest(BLESSED_CONFIG_WIDTHS);
    const fitSalted = Math.floor((BACKUP_PADDING_SIZE - sum(HEADER) - sum(CLAUSE_HEADER)) / sum(credentialWidths(zkPassport)));
    const fitSaltedWorstFraming = Math.floor((BACKUP_PADDING_SIZE - sum(HEADER)) / clauseOfOne(zkPassport));
    const fitUnsalted = Math.floor((BACKUP_PADDING_SIZE - sum(HEADER) - sum(CLAUSE_HEADER)) / (20 + 2 + zkPassport + 1));

    expect(zkPassport).toBe(256);
    expect(sum(credentialWidths(zkPassport))).toBe(311);
    expect([fitSalted, fitSaltedWorstFraming, fitUnsalted]).toEqual([7, 7, 8]);
    expect(sum(HEADER) + sum(CLAUSE_HEADER) + 8 * 279).toBe(2244);
    expect(sum(HEADER) + sum(CLAUSE_HEADER) + 9 * 279).toBeGreaterThan(BACKUP_PADDING_SIZE);
    expect(sum(HEADER) + 16 * clauseOfOne(zkPassport)).toBe(5033);
    expect(16 * (zkPassport + 32 + 20)).toBe(4928);
    // config and salt alone, without the method address or framing
    expect(16 * (96 + 32)).toBe(2048);
  });
});
