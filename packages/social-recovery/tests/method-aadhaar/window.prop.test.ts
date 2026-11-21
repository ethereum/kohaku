import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EnrollInput } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { CERTIFICATE, configBytes, MIN_FRESHNESS_WINDOW, pcdOf, QR_DATA, signalsFor, stackDouble, SYNTHETIC_UPSTREAM } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const WORD_LIMIT = 1n << 256n;
const pcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, `0x${'00'.repeat(32)}`));

/** A window the module accepts: at least one hour and inside a uint256, edges weighted. */
const acceptedArb = fc.oneof(
  fc.bigInt({ min: MIN_FRESHNESS_WINDOW, max: WORD_LIMIT - 1n }),
  fc.bigInt({ min: MIN_FRESHNESS_WINDOW, max: 1_000_000n }),
  fc.constantFrom(MIN_FRESHNESS_WINDOW, 4_500n, WORD_LIMIT - 1n),
);

/** A bigint window the module refuses: under one hour, negative included, or past a uint256. */
const refusedArb = fc.oneof(
  fc.bigInt({ min: -WORD_LIMIT, max: MIN_FRESHNESS_WINDOW - 1n }),
  fc.bigInt({ min: WORD_LIMIT, max: WORD_LIMIT << 4n }),
  fc.constantFrom(MIN_FRESHNESS_WINDOW - 1n, 0n, -1n, WORD_LIMIT),
);

const carried = (input: EnrollInput): unknown => (input as { readonly freshnessWindow?: unknown }).freshnessWindow;

describe('the holder\'s window, over any value', () => {
  it('any accepted bigint window is carried as given and written as the config\'s third word', async () => {
    await fc.assert(
      fc.asyncProperty(acceptedArb, async (freshnessWindow) => {
        const double = stackDouble({ pcd });
        const method = anonAadhaarMethod({ stack: double.stack });
        const input = method.enrollInput({ ...PARAMS, freshnessWindow });

        expect(carried(input)).toBe(freshnessWindow);
        expect(await method.configFrom(input, { qrData: QR_DATA })).toBe(configBytes(22n, 77n, freshnessWindow));
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('any safe integer of at least an hour is carried as the same bigint', () => {
    fc.assert(
      fc.property(fc.integer({ min: Number(MIN_FRESHNESS_WINDOW), max: Number.MAX_SAFE_INTEGER }), (seconds) => {
        const method = anonAadhaarMethod({ stack: stackDouble().stack });

        expect(carried(method.enrollInput({ ...PARAMS, freshnessWindow: seconds }))).toBe(BigInt(seconds));
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('any refused bigint window is a RangeError naming freshnessWindow, before any stack call', () => {
    fc.assert(
      fc.property(refusedArb, (freshnessWindow) => {
        const double = stackDouble({ pcd });

        expect(() => anonAadhaarMethod({ stack: double.stack }).enrollInput({ ...PARAMS, freshnessWindow })).toThrow(RangeError);
        expect(() => anonAadhaarMethod({ stack: double.stack }).enrollInput({ ...PARAMS, freshnessWindow })).toThrow(/freshnessWindow/);
        expect(double.total()).toBe(0);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('a hand-built input carrying any refused bigint window is material-rejected with nothing proved', async () => {
    await fc.assert(
      fc.asyncProperty(refusedArb, async (freshnessWindow) => {
        const double = stackDouble({ pcd });
        const input = { kind: 'ceremony', nullifierSeed: 77n, certificateFile: CERTIFICATE, fieldsToRevealArray: [], freshnessWindow } as EnrollInput;
        const result = await anonAadhaarMethod({ stack: double.stack }).configFrom(input, { qrData: QR_DATA });

        expect(result).toEqual({ kind: 'reply-failure', cause: 'material-rejected' });
        expect(double.proveCalls).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });
});
