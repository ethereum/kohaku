import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { assertionParts, bytesOf, configOfKey, ctxFor, hexOf, keyOfScalar } from './fixtures';
import { corrupt, digestArb, handProof, parameters, PROPERTY_TIMEOUT, scalarArb, yieldToWorker } from './property';

const method = passkeyMethod();

describe('method-passkey properties: a changed config', () => {
  it(
    'a single corrupted config byte is rejected',
    async () => {
      await fc.assert(
        fc.asyncProperty(scalarArb, fc.domain(), digestArb, fc.nat(), fc.integer({ min: 1, max: 255 }), async (scalar, relyingPartyId, digest, at, mask) => {
          await yieldToWorker();

          const key = keyOfScalar(scalar);
          const config = configOfKey(key, relyingPartyId);
          const proof = handProof(assertionParts(key, relyingPartyId, digest));

          expect(await method.verify(ctxFor(corrupt(config, at, mask), { digest: hexOf(digest) }), proof)).toBe('rejected');
          expect(bytesOf(config)).toHaveLength(96);
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
