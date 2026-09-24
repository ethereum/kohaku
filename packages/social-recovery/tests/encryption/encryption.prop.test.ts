import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BackupTooWideError,
  BackupUnopenedError,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Clause,
  type Configuration,
  type Credential,
  type Hex,
} from '../../src/index';
import { referenceSize, toHex } from './reference';
import { byteLength, expectedOpened, flipByte } from './samples';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);
const SEED = process.env['FC_SEED'] === undefined ? undefined : Number(process.env['FC_SEED']);
/** Each costly property runs as this many concurrent fast-check runs, so their PBKDF2 derivations share libuv's thread pool. */
const SHARDS = 8;
const RUNS_PER_SHARD = Math.ceil(NUM_RUNS / SHARDS);
const SHARD_TIMEOUT = 60_000 + RUNS_PER_SHARD * 3_000;
const PAYLOAD_SIZE = 12 + BACKUP_PADDING_SIZE + 16;
const SHARD_INDEXES = Array.from({ length: SHARDS }, (_, shard) => shard);

const shardParameters = (shard: number): fc.Parameters<unknown> => ({
  numRuns: RUNS_PER_SHARD,
  ...(SEED === undefined ? {} : { seed: SEED + shard }),
});

const bytesHex = (minLength: number, maxLength = minLength): fc.Arbitrary<Hex> =>
  fc.uint8Array({ minLength, maxLength }).map((bytes) => toHex(bytes));

/** Hex in either case; the opened configuration comes back lowercase. */
const anyCaseHex = (size: number): fc.Arbitrary<Hex> =>
  fc.tuple(bytesHex(size), fc.boolean()).map(([hex, upper]) => (upper ? (`0x${hex.slice(2).toUpperCase()}` as Hex) : hex));

/** The shipped config widths and arbitrary ones, the empty config included. */
const configArb = fc.oneof(
  ...[20, 32, 64, 96].map((size) => anyCaseHex(size)),
  bytesHex(288),
  bytesHex(0, 128),
);

const credentialArb: fc.Arbitrary<Credential> = fc.record(
  { method: anyCaseHex(20), config: configArb, salt: anyCaseHex(32), label: fc.string({ maxLength: 12 }) },
  { requiredKeys: ['method', 'config'] },
);

const clauseArb = (maxCredentials: number): fc.Arbitrary<Clause> =>
  fc.record({ threshold: fc.integer({ min: 0, max: 255 }), credentials: fc.array(credentialArb, { maxLength: maxCredentials }) });

const configurationArb = (maxClauses: number, maxCredentials: number): fc.Arbitrary<Configuration> =>
  fc.record({
    clauses: fc.array(clauseArb(maxCredentials), { maxLength: maxClauses }),
    wait: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
    ignoresPause: fc.boolean(),
  });

const underBound = fc
  .oneof(configurationArb(4, 6), configurationArb(1, 16))
  .filter((configuration) => referenceSize(configuration) <= BACKUP_PADDING_SIZE);

const overBound = configurationArb(2, 30).filter((configuration) => referenceSize(configuration) > BACKUP_PADDING_SIZE);

const authenticatedArb: fc.Arbitrary<BackupAuthenticated> = fc.record({
  account: anyCaseHex(20),
  action: anyCaseHex(20),
  setupCommitment: anyCaseHex(32),
  nonce: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
  payloadVersion: fc.integer({ min: 0, max: 2 ** 31 }),
});

const passwordArb = fc.oneof(fc.string({ unit: 'grapheme', maxLength: 24 }), fc.string({ unit: 'binary', maxLength: 24 }));

describe('arbitrary configurations under the bound round-trip at one length', () => {
  it.concurrent.for(SHARD_INDEXES)('shard %i', { timeout: SHARD_TIMEOUT }, async (shard) => {
    await fc.assert(
      fc.asyncProperty(underBound, passwordArb, bytesHex(12), authenticatedArb, async (configuration, password, nonce, authenticated) => {
        expect(byteLength(serializeConfiguration(configuration))).toBe(referenceSize(configuration));

        const payload = await sealBackup(configuration, password, nonce, BACKUP_PADDING_SIZE, authenticated);

        expect(byteLength(payload)).toBe(PAYLOAD_SIZE);
        expect(payload.slice(0, 26)).toBe(nonce.toLowerCase());
        expect(await openBackup(payload, password, authenticated)).toEqual(expectedOpened(configuration));
      }),
      shardParameters(shard),
    );
  });
});

describe('arbitrary configurations over the bound are refused', () => {
  it('raises BackupTooWideError with the plaintext size and the padding', async () => {
    await fc.assert(
      fc.asyncProperty(overBound, async (configuration) => {
        const error = await sealBackup(configuration, 'pw', `0x${'00'.repeat(12)}`, BACKUP_PADDING_SIZE, {
          account: `0x${'11'.repeat(20)}`,
          action: `0x${'22'.repeat(20)}`,
          setupCommitment: `0x${'33'.repeat(32)}`,
          nonce: 1n,
          payloadVersion: 1,
        }).then(
          () => undefined,
          (reason: unknown) => reason,
        );

        expect(error).toBeInstanceOf(BackupTooWideError);
        expect(error).toMatchObject({ plaintextSize: referenceSize(configuration), paddingSize: BACKUP_PADDING_SIZE });
      }),
      { numRuns: NUM_RUNS, ...(SEED === undefined ? {} : { seed: SEED }) },
    );
  }, 60_000 + NUM_RUNS * 50);
});

type Sealed = { readonly payload: Hex; readonly password: string; readonly authenticated: BackupAuthenticated };

const POOL_SIZE = 8;
let pool: readonly Sealed[] = [];
let canonicalMessage = '';

describe('any single-byte corruption fails to open', () => {
  beforeAll(async () => {
    const inputs = fc.sample(fc.tuple(underBound, passwordArb, bytesHex(12), authenticatedArb), {
      numRuns: POOL_SIZE,
      seed: SEED ?? 20260924,
    });

    pool = await Promise.all(
      inputs.map(async ([configuration, password, nonce, authenticated]) => {
        const payload = await sealBackup(configuration, password, nonce, BACKUP_PADDING_SIZE, authenticated);

        expect(await openBackup(payload, password, authenticated)).toEqual(expectedOpened(configuration));

        return { payload, password, authenticated };
      }),
    );

    const first = pool[0];

    if (first === undefined) throw new Error('empty pool');

    const wrong = await openBackup(first.payload, `${first.password}x`, first.authenticated).catch((reason: unknown) => reason);

    if (!(wrong instanceof BackupUnopenedError)) throw new Error('a wrong password must raise BackupUnopenedError');

    canonicalMessage = wrong.message;
  }, 120_000);

  it.concurrent.for(SHARD_INDEXES)('shard %i', { timeout: SHARD_TIMEOUT }, async (shard) => {
    const corruption = fc.record({
      index: fc.integer({ min: 0, max: POOL_SIZE - 1 }),
      position: fc.integer({ min: 0, max: PAYLOAD_SIZE - 1 }),
      mask: fc.integer({ min: 1, max: 255 }),
    });

    await fc.assert(
      fc.asyncProperty(corruption, async ({ index, position, mask }) => {
        const sealed = pool[index];

        if (sealed === undefined) throw new Error('pool');

        const error = await openBackup(flipByte(sealed.payload, position, mask), sealed.password, sealed.authenticated).then(
          () => undefined,
          (reason: unknown) => reason,
        );

        expect(error).toBeInstanceOf(BackupUnopenedError);
        expect((error as BackupUnopenedError).message).toBe(canonicalMessage);
        expect((error as BackupUnopenedError).payloadSize).toBe(PAYLOAD_SIZE);
      }),
      shardParameters(shard),
    );
  });
});
