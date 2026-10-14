import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { CHAIN_CLIENT_DATA_PREFIX } from './chain-model';
import { authenticatorData, base64url, configOfKey, ctxFor, FLAG_UP, FLAG_UV, hexOf, keyOfScalar, signAssertion } from './fixtures';
import { digestArb, handProof, parameters, PROPERTY_TIMEOUT, scalarArb, yieldToWorker } from './property';

const method = passkeyMethod();

/** A member name other than the two the opening fixes. */
const extraKey = fc.string({ unit: 'grapheme', maxLength: 12 }).filter((name) => !['type', 'challenge', '__proto__'].includes(name));

const scenario = fc.record({
  scalar: scalarArb,
  relyingPartyId: fc.domain(),
  digest: digestArb,
  extra: fc.dictionary(extraKey, fc.jsonValue({ maxDepth: 2 }), { maxKeys: 4 }),
  counter: fc.nat(),
});

describe('method-passkey properties: verify', () => {
  it(
    'a random key\'s assertion over a random digest, with any well-formed members after the exact opening, is satisfied and round-trips the codec',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async (run) => {
          await yieldToWorker();

          const key = keyOfScalar(run.scalar);
          const ctx = ctxFor(configOfKey(key, run.relyingPartyId), { digest: hexOf(run.digest) });
          const text = JSON.stringify({ type: 'webauthn.get', challenge: base64url(run.digest), ...run.extra });
          const authData = authenticatorData(run.relyingPartyId, FLAG_UP | FLAG_UV, run.counter);
          const proof: Hex = handProof({ authenticatorData: authData, clientDataJSON: text, signature: signAssertion(key, authData, text) });

          expect(text.startsWith(`${CHAIN_CLIENT_DATA_PREFIX}${base64url(run.digest)}"`)).toBe(true);
          expect(method.codec.encodeProof(method.codec.decodeProof(proof))).toBe(proof);
          expect(await method.verify(ctx, proof)).toBe('satisfied');
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
