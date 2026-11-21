import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { CERTIFICATE, clockForFile, configBytes, ctxFor, FRESH_NOW, FRESHNESS_WINDOW, pcdOf, QR_DATA, signalsFor, stackDouble, SYNTHETIC_UPSTREAM } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
const UNTRUSTED = { kind: 'reply-failure', cause: 'material-untrusted' };

clockForFile(FRESH_NOW);

const keyArb = fc.oneof(fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }), fc.constantFrom(0n, 1n, (1n << 256n) - 1n));

/** The key's 32-byte word, its hex digits in either case. */
const wordOf = (key: bigint, upper: boolean): Hex => {
  const digits = key.toString(16).padStart(64, '0');

  return `0x${upper ? digits.toUpperCase() : digits}`;
};

/** The proof's key and the trusted key: the same in about half the runs. */
const pairArb = fc.oneof(
  keyArb.map((key) => [key, key] as const),
  fc.tuple(keyArb, keyArb),
);

describe('the issuer key against the trusted word, over any pair of keys', () => {
  it('configFrom gives the config exactly when the trusted word is the proof\'s key, else material-untrusted', async () => {
    await fc.assert(
      fc.asyncProperty(pairArb, fc.boolean(), async ([proved, trusted], upper) => {
        const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { pubkeyHash: proved })) });
        const method = anonAadhaarMethod({ stack: double.stack });
        const result = await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [wordOf(trusted, upper)] }), { qrData: QR_DATA });

        if (proved === trusted) expect(result).toBe(configBytes(22n, 77n, FRESHNESS_WINDOW));
        else expect(result).toEqual(UNTRUSTED);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('replyFrom hands the proof to the local verdict exactly when the trusted word is the proof\'s key, else material-untrusted with no verify', async () => {
    await fc.assert(
      fc.asyncProperty(pairArb, fc.boolean(), async ([proved, trusted], upper) => {
        const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { pubkeyHash: proved })), verify: 'throw' });
        const method = anonAadhaarMethod({ stack: double.stack });
        const result = await method.replyFrom(ctx, method.signingInput(ctx, { ...PARAMS, trustedKeys: [wordOf(trusted, upper)] }), { qrData: QR_DATA });

        if (proved === trusted) {
          expect(typeof result).toBe('string');
          expect(double.verifyCalls).toHaveLength(1);
        } else {
          expect(result).toEqual(UNTRUSTED);
          expect(double.verifyCalls).toHaveLength(0);
        }
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });
});
