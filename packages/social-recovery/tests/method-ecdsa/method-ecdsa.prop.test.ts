import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { walletMethod, type Hex } from '../../src/index';
import { CURVE_ORDER, ctxFor, highSTwin, signDigest } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const method = walletMethod();

const privateKeyArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => bytesToHex(bytes))
  .filter((key) => {
    const value = BigInt(key);

    return value > 0n && value < CURVE_ORDER;
  });

const placeArb = fc.record({
  attemptId: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
  place: fc.integer({ min: 0, max: 255 }),
  purpose: fc.constantFrom('approval' as const, 'cancellation' as const),
  credentialHoldsCode: fc.boolean(),
});

describe('method-ecdsa properties', () => {
  it('a random key signing a random place: codec round trip, reply unchanged, verify satisfied', async () => {
    await fc.assert(
      fc.asyncProperty(privateKeyArb, placeArb, async (key, options) => {
        const guardian = privateKeyToAccount(key).address;
        const ctx = ctxFor({ ...options, guardian });
        const signature = await signDigest(ctx.digest, key as Hex);

        expect(method.codec.encodeProof(method.codec.decodeProof(signature)).toLowerCase()).toBe(signature);
        expect(String(method.codec.decodeConfig(ctx.request.config)['signer']).toLowerCase()).toBe(guardian.toLowerCase());

        const proof = await method.replyFrom(ctx, method.signingInput(ctx), { signature });

        expect(proof).toBe(signature);
        expect(await method.verify(ctx, proof as Hex)).toBe('satisfied');

        const lowered = await method.replyFrom(ctx, method.signingInput(ctx), { signature: highSTwin(signature, options.attemptId % 2n === 0n) });

        expect(lowered).toBe(signature);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});
