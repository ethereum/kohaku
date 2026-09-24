import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  BackupTooWideError,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Configuration,
  type Credential,
  type Hex,
} from '../../src/index';
import {
  AADHAAR_CONFIG_BLESSED,
  AADHAAR_CONFIG_WORD,
  AUTHENTICATED,
  byteLength,
  expectedOpened,
  METHOD_AADHAAR,
  METHOD_PASSKEY,
  METHOD_WALLET,
  METHOD_ZKPASSPORT,
  MIXED_RULE,
  NONCE,
  oneCredentialRule,
  PASSKEY_CONFIG,
  passkeyClausesRule,
  passkeyRule,
  PASSWORD,
  SALT_A,
  WALLET_CONFIG_ADDRESS,
  WALLET_CONFIG_WORD,
  ZKPASSPORT_CONFIG_BLESSED,
  ZKPASSPORT_CONFIG_WORD,
} from './samples';

const TIMEOUT = 60_000;
const PAYLOAD_SIZE = 12 + BACKUP_PADDING_SIZE + 16;

const seal = (configuration: Configuration, password = PASSWORD, nonce: Hex = NONCE): Promise<Hex> =>
  sealBackup(configuration, password, nonce, BACKUP_PADDING_SIZE, AUTHENTICATED);

const credential = (method: Hex, config: Hex, salt?: Hex): Credential => ({ method, config, ...(salt === undefined ? {} : { salt }) });

const METHOD_RULES: ReadonlyArray<readonly [string, Configuration]> = [
  ['wallet, config as a 20-byte address', oneCredentialRule(credential(METHOD_WALLET, WALLET_CONFIG_ADDRESS))],
  ['wallet, config as one word (method-ecdsa-config)', oneCredentialRule(credential(METHOD_WALLET, WALLET_CONFIG_WORD))],
  ['passkey, three words, 96 bytes', oneCredentialRule(credential(METHOD_PASSKEY, PASSKEY_CONFIG))],
  ['zkPassport, one identity commitment word', oneCredentialRule(credential(METHOD_ZKPASSPORT, ZKPASSPORT_CONFIG_WORD))],
  ['zkPassport, the blessed 288-byte config', oneCredentialRule(credential(METHOD_ZKPASSPORT, ZKPASSPORT_CONFIG_BLESSED))],
  ['Aadhaar, one identity commitment word', oneCredentialRule(credential(METHOD_AADHAAR, AADHAAR_CONFIG_WORD))],
  ['Aadhaar, the blessed 64-byte config', oneCredentialRule(credential(METHOD_AADHAAR, AADHAAR_CONFIG_BLESSED))],
];

describe.concurrent('a rule of every shipped method round-trips', () => {
  it.for(METHOD_RULES)('%s', { timeout: TIMEOUT }, async ([, configuration], { expect }) => {
    const payload = await seal(configuration);

    expect(byteLength(payload)).toBe(PAYLOAD_SIZE);
    expect(await openBackup(payload, PASSWORD, AUTHENTICATED)).toEqual(expectedOpened(configuration));
  });
});

const SALTED_RULES: ReadonlyArray<readonly [string, Configuration]> = [
  ['every shipped method across two clauses, labels, supplied salts, the largest wait', MIXED_RULE],
  ['16 passkeys each with a supplied salt in one clause (2428 bytes)', passkeyRule(16, true)],
  ['16 passkeys each with a supplied salt in 16 clauses (2473 bytes, the worst case)', passkeyClausesRule(16)],
  ['16 passkeys without supplied salts', passkeyRule(16, false)],
  ['one credential whose salt is all zero bytes', oneCredentialRule(credential(METHOD_WALLET, WALLET_CONFIG_WORD, `0x${'00'.repeat(32)}`))],
  ['no clause, wait 0, pause false', { clauses: [], wait: 0, ignoresPause: false }],
  ['a clause with no credential and threshold 0', { clauses: [{ threshold: 0, credentials: [] }], wait: 1, ignoresPause: true }],
  ['an empty config', oneCredentialRule(credential(METHOD_WALLET, '0x', SALT_A))],
];

describe.concurrent('configurations carrying supplied salts and boundary shapes round-trip', () => {
  it.for(SALTED_RULES)('%s', { timeout: TIMEOUT }, async ([, configuration], { expect }) => {
    const payload = await seal(configuration);

    expect(byteLength(payload)).toBe(PAYLOAD_SIZE);
    expect(await openBackup(payload, PASSWORD, AUTHENTICATED)).toEqual(expectedOpened(configuration));
  });

  it('keeps a supplied salt and adds none where the holder supplied none', async ({ expect }) => {
    const opened = await openBackup(await seal(MIXED_RULE), PASSWORD, AUTHENTICATED);
    const credentials = opened.clauses.flatMap((clause) => clause.credentials);

    expect(credentials.map((item) => item.salt)).toEqual([undefined, SALT_A, undefined, MIXED_RULE.clauses[1]?.credentials[0]?.salt]);
    expect(credentials.every((item) => item.label === undefined)).toBe(true);
    expect(credentials.filter((item) => 'salt' in item)).toHaveLength(2);
  }, TIMEOUT);

  it('round-trips a serialization exactly at the padding size (2473 bytes)', async ({ expect }) => {
    // 9 + 16 x 154 = 2473: the worst case, leaving no byte of padding
    const filled = passkeyClausesRule(16);
    const payload = await seal(filled);

    expect(byteLength(serializeConfiguration(filled))).toBe(2473);
    expect(byteLength(serializeConfiguration(filled))).toBe(BACKUP_PADDING_SIZE);
    expect(byteLength(payload)).toBe(PAYLOAD_SIZE);
    expect(await openBackup(payload, PASSWORD, AUTHENTICATED)).toEqual(expectedOpened(filled));
  }, TIMEOUT);

  it('fits 16 salted passkeys in one clause (2428 bytes) and in 16 clauses (2473 bytes)', async ({ expect }) => {
    const oneClause = passkeyRule(16, true);
    const sixteenClauses = passkeyClausesRule(16);
    const [first, second] = await Promise.all([seal(oneClause), seal(sixteenClauses)]);

    expect(byteLength(serializeConfiguration(oneClause))).toBe(2428);
    expect(byteLength(serializeConfiguration(sixteenClauses))).toBe(2473);
    expect(byteLength(first)).toBe(PAYLOAD_SIZE);
    expect(byteLength(second)).toBe(PAYLOAD_SIZE);
    expect(await openBackup(first, PASSWORD, AUTHENTICATED)).toEqual(expectedOpened(oneClause));
    expect(await openBackup(second, PASSWORD, AUTHENTICATED)).toEqual(expectedOpened(sixteenClauses));
  }, TIMEOUT);

  it.for([
    ['the empty password', ''],
    ['a non-ASCII password', 'pässwörd 🔑 密码'],
    ['a long password', 'x'.repeat(4096)],
  ] as const)('round-trips under %s', { timeout: TIMEOUT }, async ([, password], { expect }) => {
    const payload = await seal(MIXED_RULE, password);

    expect(await openBackup(payload, password, AUTHENTICATED)).toEqual(expectedOpened(MIXED_RULE));
  });
});

describe.concurrent('determinism', () => {
  it('seals the same inputs and nonce to identical bytes', async ({ expect }) => {
    const [first, second] = await Promise.all([seal(MIXED_RULE), seal(MIXED_RULE)]);

    expect(second).toBe(first);
  }, TIMEOUT);

  it('carries the caller nonce as the payload prefix and changes every other byte with it', async ({ expect }) => {
    const other: Hex = '0xffffffffffffffffffffffff';
    const [first, second] = await Promise.all([seal(MIXED_RULE), seal(MIXED_RULE, PASSWORD, other)]);

    expect(first.slice(0, 2 + 24)).toBe(NONCE);
    expect(second.slice(0, 2 + 24)).toBe(other);
    expect(second.slice(26)).not.toBe(first.slice(26));
    expect(byteLength(second)).toBe(byteLength(first));
  }, TIMEOUT);

  it('changes the sealed bytes when the password changes', async ({ expect }) => {
    const [first, second] = await Promise.all([seal(MIXED_RULE), seal(MIXED_RULE, `${PASSWORD}!`)]);

    expect(second).not.toBe(first);
  }, TIMEOUT);
});

describe.concurrent('one fixed length', () => {
  it('gives rules of different widths one payload length', async ({ expect }) => {
    const rules = [...METHOD_RULES.map(([, rule]) => rule), ...SALTED_RULES.map(([, rule]) => rule)];
    const payloads = await Promise.all(rules.map((rule) => seal(rule)));
    const lengths = new Set(payloads.map(byteLength));

    expect([...lengths]).toEqual([PAYLOAD_SIZE]);
    expect(PAYLOAD_SIZE).toBe(2501);
  }, TIMEOUT);

  it.for([
    ['a smaller padding (512)', 512],
    ['a larger padding (4096)', 4096],
    ['the rule\'s exact serialization length', -1],
    ['a zero padding', 0],
  ] as const)('refuses %s with a RangeError and produces no payload (no integrator overrides)', { timeout: TIMEOUT }, async ([, size], { expect }) => {
    const narrow = oneCredentialRule(credential(METHOD_WALLET, WALLET_CONFIG_WORD));
    const paddingSize = size === -1 ? byteLength(serializeConfiguration(narrow)) : size;
    let produced: Hex | undefined;
    let error: unknown;

    try {
      produced = await sealBackup(narrow, PASSWORD, NONCE, paddingSize, AUTHENTICATED);
    } catch (caught) {
      error = caught;
    }

    expect(produced).toBeUndefined();
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(BackupTooWideError);
    expect((error as RangeError).message).toContain(String(BACKUP_PADDING_SIZE));
  });
});

type FixtureVector = {
  readonly 'id': string;
  readonly input: {
    readonly configuration: Configuration;
    readonly password: string;
    readonly nonce: Hex;
    readonly paddingSize: number;
    readonly authenticated: Omit<BackupAuthenticated, 'nonce'> & { readonly nonce: string };
  };
  readonly expected: {
    readonly serialization: Hex;
    readonly serializationSize: number;
    readonly payload?: Hex;
    readonly payloadSize?: number;
    readonly refusal?: { readonly error: string; readonly plaintextSize: number; readonly paddingSize: number };
  };
};

type FixtureFile = {
  readonly format: string;
  readonly blessed: boolean;
  readonly paddingSize: number;
  readonly payloadVersion: number;
  readonly vectors: readonly FixtureVector[];
};

/** Produced by the node:crypto reference, never by sealBackup, so the replay is not circular. */
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/backup-payload.json', import.meta.url), 'utf8')) as FixtureFile;
const authenticatedOf = (vector: FixtureVector): BackupAuthenticated => ({
  ...vector.input.authenticated,
  nonce: BigInt(vector.input.authenticated.nonce),
});

describe.concurrent('replays the unblessed backup-payload fixture byte for byte', () => {
  it('is marked unblessed and states the shipped numbers', ({ expect }) => {
    expect(FIXTURE.blessed).toBe(false);
    expect(FIXTURE.paddingSize).toBe(BACKUP_PADDING_SIZE);
    expect(FIXTURE.vectors.every((vector) => vector.input.paddingSize === BACKUP_PADDING_SIZE)).toBe(true);
    expect(FIXTURE.vectors.some((vector) => vector.expected.serializationSize === BACKUP_PADDING_SIZE && vector.expected.payload !== undefined)).toBe(true);
    expect(FIXTURE.payloadVersion).toBe(BACKUP_PAYLOAD_VERSION);
    expect(FIXTURE.vectors.filter((vector) => vector.expected.payload !== undefined).length).toBeGreaterThan(0);
  });

  it.for(FIXTURE.vectors.map((vector) => [vector['id'], vector] as const))('%s', { timeout: TIMEOUT }, async ([, vector], { expect }) => {
    const { configuration, password, nonce, paddingSize } = vector.input;
    const authenticated = authenticatedOf(vector);

    expect(serializeConfiguration(configuration)).toBe(vector.expected.serialization);
    expect(byteLength(vector.expected.serialization)).toBe(vector.expected.serializationSize);

    if (vector.expected.refusal !== undefined) {
      const attempt = sealBackup(configuration, password, nonce, paddingSize, authenticated);

      await expect(attempt).rejects.toBeInstanceOf(BackupTooWideError);
      await expect(attempt).rejects.toMatchObject({
        plaintextSize: vector.expected.refusal.plaintextSize,
        paddingSize: vector.expected.refusal.paddingSize,
      });

      return;
    }

    const payload = await sealBackup(configuration, password, nonce, paddingSize, authenticated);

    expect(payload).toBe(vector.expected.payload);
    expect(byteLength(payload)).toBe(vector.expected.payloadSize);
    expect(await openBackup(payload, password, authenticated)).toEqual(expectedOpened(configuration));
  });
});
