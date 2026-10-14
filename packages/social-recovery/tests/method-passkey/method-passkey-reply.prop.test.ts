import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { assertionParts, assertionRecord, bytesOf, configOfKey, ctxFor, hexOf, keyOfScalar } from './fixtures';
import { digestArb, handProof, parameters, PROPERTY_TIMEOUT, scalarArb, yieldToWorker } from './property';

const method = passkeyMethod();

describe('method-passkey properties: the reply', () => {
  it(
    'the browser\'s assertion over the digest, high s or low, is replied as the hand-packaged proof with a low s',
    async () => {
      await fc.assert(
        fc.asyncProperty(scalarArb, fc.domain(), digestArb, async (scalar, relyingPartyId, digest) => {
          await yieldToWorker();

          const key = keyOfScalar(scalar);
          const ctx = ctxFor(configOfKey(key, relyingPartyId), { digest: hexOf(digest) });
          const signing = method.signingInput(ctx, { relyingPartyId });
          const parts = assertionParts(key, relyingPartyId, bytesOf(ctx.digest));

          expect(await method.replyFrom(ctx, signing, { assertion: assertionRecord(parts) })).toBe(handProof(parts));
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
