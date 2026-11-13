import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_LEGACY_PAYLOAD_VERSION,
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  BACKUP_UNOPENED_MESSAGE,
  BackupTooWideError,
  BackupUnopenedError,
  openBackup,
  sealBackup,
  type Hex,
} from '../../src/index';
import { AUTHENTICATED, MIXED_RULE, NONCE, PASSWORD } from './samples';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);
const SEED = process.env['FC_SEED'] === undefined ? undefined : Number(process.env['FC_SEED']);
const PARAMETERS: fc.Parameters<unknown> = { numRuns: NUM_RUNS, ...(SEED === undefined ? {} : { seed: SEED }) };
const TIMEOUT = 60_000;
const PAYLOAD_SIZE = 12 + BACKUP_PADDING_SIZE + 16;

/** Any 2501-byte hex: a version refusal comes before the payload's bytes are read. */
const payloadArb: fc.Arbitrary<Hex> = fc
  .uint8Array({ minLength: PAYLOAD_SIZE, maxLength: PAYLOAD_SIZE })
  .map((bytes) => `0x${Buffer.from(bytes).toString('hex')}` as Hex);

/** A payload version in the uint256 field's safe-integer range, small values drawn often. */
const versionArb = fc.oneof(fc.integer({ min: 0, max: 8 }), fc.maxSafeNat());

/** Counts the two WebCrypto calls a key derivation makes; restored by vi.restoreAllMocks. */
function spyOnDerivation(): () => number {
  const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
  const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

  return () => importKey.mock.calls.length + deriveKey.mock.calls.length;
}

const settle = (attempt: Promise<unknown>): Promise<unknown> =>
  attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );

describe('payload versions over arbitrary values', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sealBackup refuses every version but the written one with a RangeError, deriving no key', async () => {
    const derivations = spyOnDerivation();

    await fc.assert(
      fc.asyncProperty(versionArb.filter((version) => version !== BACKUP_PAYLOAD_VERSION), async (payloadVersion) => {
        const error = await settle(sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, { ...AUTHENTICATED, payloadVersion }));

        expect(error).toBeInstanceOf(RangeError);
        expect(error).not.toBeInstanceOf(BackupTooWideError);
        expect(derivations()).toBe(0);
      }),
      PARAMETERS,
    );
  }, TIMEOUT);

  it('openBackup refuses every version but 2 and 1 as the unopened failure carrying the size, deriving no key', async () => {
    const derivations = spyOnDerivation();
    const unread = versionArb.filter((version) => version !== BACKUP_PAYLOAD_VERSION && version !== BACKUP_LEGACY_PAYLOAD_VERSION);

    await fc.assert(
      fc.asyncProperty(payloadArb, unread, async (payload, payloadVersion) => {
        const error = await settle(openBackup(payload, PASSWORD, { ...AUTHENTICATED, payloadVersion }));

        expect(error).toBeInstanceOf(BackupUnopenedError);
        expect((error as BackupUnopenedError).message).toBe(BACKUP_UNOPENED_MESSAGE);
        expect((error as BackupUnopenedError).payloadSize).toBe(PAYLOAD_SIZE);
        expect(derivations()).toBe(0);
      }),
      PARAMETERS,
    );
  }, TIMEOUT);
});
