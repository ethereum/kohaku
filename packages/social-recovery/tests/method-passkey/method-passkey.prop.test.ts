import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import {
  assertionParts,
  assertionRecord,
  configOfKey,
  creation,
  ctxFor,
  hexOf,
  keyOfScalar,
  N,
} from './fixtures';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seed = process.env['FC_SEED'] === undefined ? undefined : Number(process.env['FC_SEED']);
const parameters = { numRuns, ...(seed === undefined ? {} : { seed }) };

const method = passkeyMethod();

/** The hex with byte `index` (mod its length) XORed by `mask`. */
const corrupt = (hex: Hex, index: number, mask: number): Hex => {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  const at = index % bytes.length;

  bytes[at] = (bytes[at] ?? 0) ^ mask;

  return `0x${bytes.toString('hex')}`;
};

const scenario = fc.record({
  scalar: fc.bigInt({ min: 1n, max: N - 1n }),
  relyingPartyId: fc.domain(),
  otherRelyingPartyId: fc.domain(),
  userName: fc.string({ minLength: 1, maxLength: 64 }),
  digest: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  proofByte: fc.nat(),
  configByte: fc.nat(),
  mask: fc.integer({ min: 1, max: 255 }),
});

describe('method-passkey properties', () => {
  it(
    'enrollment, assertion, codec and verify round-trip; a single corrupted byte fails verify',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async (run) => {
          // Signing is synchronous; yielding once per run keeps the vitest worker's RPC answered on long runs.
          await new Promise<void>((resolve) => setImmediate(resolve));

          const key = keyOfScalar(run.scalar);
          const input = method.enrollInput({ relyingPartyId: run.relyingPartyId, userName: run.userName });
          const config = await method.configFrom(input, { credential: creation(key, run.relyingPartyId) });

          expect(config).toBe(configOfKey(key, run.relyingPartyId));

          const ctx = ctxFor(config as Hex, { digest: hexOf(run.digest) });
          const signing = method.signingInput(ctx, { relyingPartyId: run.relyingPartyId });
          const challenge = (signing['options'] as { publicKey: { challenge: Uint8Array } }).publicKey.challenge;

          expect(hexOf(challenge)).toBe(ctx.digest);

          const parts = assertionParts(key, run.relyingPartyId, challenge);
          const proof = await method.replyFrom(ctx, signing, { assertion: assertionRecord(parts) });

          expect(typeof proof).toBe('string');

          const proofHex = proof as Hex;

          expect(method.codec.encodeConfig(method.codec.decodeConfig(ctx.request.config))).toBe(ctx.request.config);
          expect(method.codec.encodeProof(method.codec.decodeProof(proofHex))).toBe(proofHex);
          expect(await method.verify(ctx, proofHex)).toBe('satisfied');

          expect(await method.verify(ctx, corrupt(proofHex, run.proofByte, run.mask))).toBe('rejected');

          const badConfig = ctxFor(corrupt(ctx.request.config, run.configByte, run.mask), { digest: ctx.digest });

          expect(await method.verify(badConfig, proofHex)).toBe('rejected');

          if (run.otherRelyingPartyId !== run.relyingPartyId) {
            const elsewhere = ctxFor(configOfKey(key, run.otherRelyingPartyId), { digest: ctx.digest });

            expect(await method.verify(elsewhere, proofHex)).toBe('rejected');
          }
        }),
        parameters,
      );
    },
    60 * 60 * 1000,
  );
});
