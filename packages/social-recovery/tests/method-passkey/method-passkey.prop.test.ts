import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { configOfKey, creation, ctxFor, hexOf, keyOfScalar } from './fixtures';
import { digestArb, parameters, PROPERTY_TIMEOUT, scalarArb } from './property';

const method = passkeyMethod();

const scenario = fc.record({
  scalar: scalarArb,
  relyingPartyId: fc.domain(),
  userName: fc.string({ minLength: 1, maxLength: 64 }),
  digest: digestArb,
});

describe('method-passkey properties: enrollment and the signing input', () => {
  it(
    'a random key enrolls to its own config, which round-trips the codec, and the signing input carries the digest as the challenge under the same id',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async (run) => {
          const key = keyOfScalar(run.scalar);
          const input = method.enrollInput({ relyingPartyId: run.relyingPartyId, userName: run.userName });
          const config = await method.configFrom(input, { credential: creation(key, run.relyingPartyId) });

          expect(config).toBe(configOfKey(key, run.relyingPartyId));
          expect(method.codec.encodeConfig(method.codec.decodeConfig(config as Hex))).toBe(config);

          const ctx = ctxFor(config as Hex, { digest: hexOf(run.digest) });
          const signing = method.signingInput(ctx, { relyingPartyId: run.relyingPartyId });
          const options = signing['options'] as { publicKey: { challenge: Uint8Array; rpId: string } };

          expect(hexOf(options.publicKey.challenge)).toBe(ctx.digest);
          expect(options.publicKey.rpId).toBe(run.relyingPartyId);
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
