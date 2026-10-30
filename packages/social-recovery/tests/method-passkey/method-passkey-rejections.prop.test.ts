import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { assertionParts, bytesOf, configOfKey, ctxFor, hexOf, keyOfScalar } from './fixtures';
import { corrupt, digestArb, handProof, parameters, PROPERTY_TIMEOUT, scalarArb, yieldToWorker } from './property';

const method = passkeyMethod();

const scenario = fc.record({
  scalar: scalarArb,
  relyingPartyId: fc.domain(),
  otherRelyingPartyId: fc.domain(),
  digest: digestArb,
  proofByte: fc.nat(),
  mask: fc.integer({ min: 1, max: 255 }),
});

describe('method-passkey properties: a changed proof', () => {
  it(
    'a single corrupted proof byte is rejected, and so is the proof under another relying party',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async (run) => {
          await yieldToWorker();

          const key = keyOfScalar(run.scalar);
          const ctx = ctxFor(configOfKey(key, run.relyingPartyId), { digest: hexOf(run.digest) });
          const proof = handProof(assertionParts(key, run.relyingPartyId, bytesOf(ctx.digest)));

          expect(await method.verify(ctx, corrupt(proof, run.proofByte, run.mask))).toBe('rejected');

          if (run.otherRelyingPartyId !== run.relyingPartyId) {
            const elsewhere = ctxFor(configOfKey(key, run.otherRelyingPartyId), { digest: ctx.digest });

            expect(await method.verify(elsewhere, proof)).toBe('rejected');
          }
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
