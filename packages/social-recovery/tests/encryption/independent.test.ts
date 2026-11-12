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
  BACKUP_LEGACY_PAYLOAD_VERSION,
  BACKUP_LENGTH_SIZE,
  BACKUP_NONCE_SIZE,
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  BACKUP_READ_PAYLOAD_VERSIONS,
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
  LEGACY_AUTHENTICATED,
  MIXED_RULE,
  NONCE,
  passkeyClausesRule,
  passkeyRule,
  PASSWORD,
} from './samples';

const TIMEOUT = 60_000;
const UNICODE_PASSWORD = 'pässwörd 🔑 密码';

describe('the sealed payload against node:crypto', () => {
  it('opens under node PBKDF2-HMAC-SHA256 600k salted with the associated data and AES-256-GCM to the documented plaintext', async () => {
    const payload = toBytes(await sealBackup(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const plaintext = referenceOpenRaw(referenceKey(UNICODE_PASSWORD, associatedData), payload, associatedData);

    expect(associatedData.length).toBe(160);
    expect(payload.length).toBe(12 + BACKUP_PADDING_SIZE + 16);
    expect(toHex(payload.subarray(0, 12))).toBe(NONCE);
    expect(plaintext.length).toBe(BACKUP_PADDING_SIZE);
    expect(toHex(plaintext)).toBe(toHex(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)));
    expect(serializeConfiguration(MIXED_RULE)).toBe(toHex(referenceSerialize(MIXED_RULE)));
  }, TIMEOUT);

  it('matches a node:crypto seal under version 2, salt = AD, byte for byte, and openBackup opens the node seal', async () => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const reference = toHex(
      referenceSealRaw(
        referenceKey(UNICODE_PASSWORD, associatedData),
        toBytes(NONCE),
        associatedData,
        referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE),
      ),
    );
    const shipped = await sealBackup(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);
    const opened = await openBackup(reference, UNICODE_PASSWORD, AUTHENTICATED);

    expect(AUTHENTICATED.payloadVersion).toBe(2);
    expect(shipped).toBe(reference);
    expect(referenceSeal(MIXED_RULE, UNICODE_PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED)).toBe(reference);
    expect(serializeConfiguration(opened)).toBe(toHex(referenceSerialize(MIXED_RULE)));
  }, TIMEOUT);

  it('does not open under a key node derives with any other iteration count', async () => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const plaintext = referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE);
    // the same salt as the scheme, so only the iteration count differs
    const weakKey = pbkdf2Key(UNICODE_PASSWORD, associatedData, 599_999);
    const forged = toHex(referenceSealRaw(weakKey, toBytes(NONCE), associatedData, plaintext));
    const genuine = toHex(referenceSealRaw(referenceKey(UNICODE_PASSWORD, associatedData), toBytes(NONCE), associatedData, plaintext));

    await expect(openBackup(forged, UNICODE_PASSWORD, AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
    await expect(openBackup(genuine, UNICODE_PASSWORD, AUTHENTICATED)).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);

  it('binds the version in the associated data and the salt, so a node seal under version 2 opens only under 2', async () => {
    const sealed = referenceSeal(MIXED_RULE, 'pw', NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    await expect(openBackup(sealed, 'pw', AUTHENTICATED)).resolves.toBeDefined();
    await expect(openBackup(sealed, 'pw', LEGACY_AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);
});

/** A second setup whose account, action, setup commitment and setup nonce all differ from `AUTHENTICATED`, at the same version. */
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
  ['payload version, the legacy 1', LEGACY_AUTHENTICATED],
  ['payload version, an unread 3', { ...AUTHENTICATED, payloadVersion: 3 }],
];

/** The PBKDF2 salt a spied `crypto.subtle.deriveKey` call was handed, as bytes. */
const saltOf = (algorithm: unknown): Buffer => {
  const { salt } = algorithm as Pbkdf2Params;

  return ArrayBuffer.isView(salt) ? Buffer.from(salt.buffer, salt.byteOffset, salt.byteLength) : Buffer.from(salt);
};

/** Opens a payload's ciphertext with an already derived WebCrypto key under the given associated data. */
const decryptWith = (key: CryptoKey, payload: Buffer, associatedData: Buffer): Promise<ArrayBuffer> =>
  globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(payload.subarray(0, 12)), additionalData: new Uint8Array(associatedData), tagLength: 128 },
    key,
    new Uint8Array(payload.subarray(12)),
  );

describe('the version-2 key is PBKDF2 over the password with the 160-byte associated data as the salt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not open under the former key, PBKDF2 with a zero-length salt', async () => {
    const payload = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const formerKey = referenceKey(PASSWORD, Buffer.alloc(0));
    const formerSeal = toHex(referenceSealRaw(formerKey, toBytes(NONCE), associatedData, referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)));

    expect(associatedData.length).toBe(160);
    expect(formerKey.equals(referenceKey(PASSWORD, associatedData))).toBe(false);
    expect(() => referenceOpenRaw(formerKey, payload, associatedData)).toThrow();
    await expect(openBackup(formerSeal, PASSWORD, AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);

  it('hands crypto.subtle.deriveKey the 160-byte associated data as the salt and 600,000 iterations, a salt per authenticated set', async () => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const payload = await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP);
    await openBackup(payload, PASSWORD, AUTHENTICATED);

    const params = deriveKey.mock.calls.map(([algorithm]) => algorithm as Pbkdf2Params);
    const salts = deriveKey.mock.calls.map(([algorithm]) => saltOf(algorithm));
    const expected = [AUTHENTICATED, OTHER_SETUP, AUTHENTICATED].map(referenceAssociatedData);

    expect(params).toHaveLength(3);
    expect(params.map(({ iterations }) => iterations)).toEqual([600_000, 600_000, 600_000]);
    expect(salts.map((salt) => salt.length)).toEqual([160, 160, 160]);
    expect(salts.map(toHex)).toEqual(expected.map(toHex));
    expect(toHex(salts[0] ?? Buffer.alloc(0))).not.toBe(toHex(salts[1] ?? Buffer.alloc(0)));
  }, TIMEOUT);

  it('gives two setups two keys under one password: the key derived for one setup decrypts only that setup\'s payload', async () => {
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const first = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const second = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP));
    const [firstKey, secondKey] = await Promise.all(deriveKey.mock.results.map(({ value }) => value as Promise<CryptoKey>));
    const firstData = referenceAssociatedData(AUTHENTICATED);
    const secondData = referenceAssociatedData(OTHER_SETUP);
    const plaintext = toHex(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE));

    if (firstKey === undefined || secondKey === undefined) throw new Error('expected two derived keys');

    expect(toHex(new Uint8Array(await decryptWith(firstKey, first, firstData)))).toBe(plaintext);
    expect(toHex(new Uint8Array(await decryptWith(secondKey, second, secondData)))).toBe(plaintext);
    await expect(decryptWith(firstKey, second, secondData)).rejects.toThrow();
    await expect(decryptWith(secondKey, first, firstData)).rejects.toThrow();
  }, TIMEOUT);

  it('opens payloads sealed for two different setups each under its own node key only', async () => {
    const plaintext = referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE);
    const sealFor = async (authenticated: BackupAuthenticated): Promise<Buffer> =>
      toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, authenticated));
    const [first, second] = await Promise.all([sealFor(AUTHENTICATED), sealFor(OTHER_SETUP)]);
    const firstData = referenceAssociatedData(AUTHENTICATED);
    const secondData = referenceAssociatedData(OTHER_SETUP);
    const firstKey = referenceKey(PASSWORD, firstData);
    const secondKey = referenceKey(PASSWORD, secondData);

    expect(referenceOpenRaw(firstKey, first, firstData).equals(plaintext)).toBe(true);
    expect(referenceOpenRaw(secondKey, second, secondData).equals(plaintext)).toBe(true);
    expect(() => referenceOpenRaw(firstKey, second, secondData)).toThrow();
    expect(() => referenceOpenRaw(secondKey, first, firstData)).toThrow();
  }, TIMEOUT);

  const body = (payload: Buffer): Buffer => payload.subarray(12, 12 + BACKUP_PADDING_SIZE);
  const xor = (left: Buffer, right: Buffer): Buffer => Buffer.from(left.map((byte, index) => byte ^ (right[index] ?? 0)));

  it('shares no keystream across two setups under one password and one nonce', async () => {
    const other = passkeyRule(3, true);
    const first = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const second = toBytes(await sealBackup(other, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP));

    expect(xor(body(first), body(second)).equals(
      xor(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE), referencePlaintext(other, BACKUP_PADDING_SIZE)),
    )).toBe(false);
  }, TIMEOUT);

  it('shares one keystream between two seals of one setup under one password, so a nonce must not repeat for that setup', async () => {
    const other = passkeyRule(3, true);
    const first = toBytes(await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const second = toBytes(await sealBackup(other, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));

    expect(xor(body(first), body(second)).equals(
      xor(referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE), referencePlaintext(other, BACKUP_PADDING_SIZE)),
    )).toBe(true);
  }, TIMEOUT);

  it('opens a node seal through openBackup under its own five values', async () => {
    const sealed = referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, OTHER_SETUP);

    await expect(openBackup(sealed, PASSWORD, OTHER_SETUP)).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);

  it.for(ONE_AT_A_TIME)('still binds the %s: a version-2 node seal does not open when only that value differs', { timeout: TIMEOUT }, async ([, foreign]) => {
    const sealed = referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    await expect(openBackup(sealed, PASSWORD, foreign)).rejects.toBeInstanceOf(BackupUnopenedError);
  });
});

describe('version 1 is opened, never sealed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a node seal keyed over a zero-length salt under payloadVersion 1, deriving with that empty salt', async () => {
    const associatedData = referenceAssociatedData(LEGACY_AUTHENTICATED);
    const sealed = toHex(
      referenceSealRaw(
        referenceKey(PASSWORD, Buffer.alloc(0)),
        toBytes(NONCE),
        associatedData,
        referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE),
      ),
    );
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    expect(referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, LEGACY_AUTHENTICATED)).toBe(sealed);
    await expect(openBackup(sealed, PASSWORD, LEGACY_AUTHENTICATED)).resolves.toEqual(expectedOpened(MIXED_RULE));
    expect(deriveKey.mock.calls.map(([algorithm]) => saltOf(algorithm).length)).toEqual([0]);
  }, TIMEOUT);

  it('does not open a version-1 node seal keyed over the associated data, the version-2 salt', async () => {
    const associatedData = referenceAssociatedData(LEGACY_AUTHENTICATED);
    const sealed = toHex(
      referenceSealRaw(referenceKey(PASSWORD, associatedData), toBytes(NONCE), associatedData, referencePlaintext(MIXED_RULE, BACKUP_PADDING_SIZE)),
    );

    await expect(openBackup(sealed, PASSWORD, LEGACY_AUTHENTICATED)).rejects.toBeInstanceOf(BackupUnopenedError);
  }, TIMEOUT);
});

describe('authentic plaintexts the layout does not describe', () => {
  const sealRaw = (plaintext: Buffer): Hex => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);

    return toHex(referenceSealRaw(referenceKey('pw', associatedData), toBytes(NONCE), associatedData, plaintext));
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
    expect(BACKUP_PAYLOAD_VERSION).toBe(2);
    expect(BACKUP_LEGACY_PAYLOAD_VERSION).toBe(1);
    expect(BACKUP_READ_PAYLOAD_VERSIONS).toEqual([2, 1]);
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
