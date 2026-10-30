import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  CERTIFICATE,
  clockAt,
  configBytes,
  ctxFor,
  FRESHNESS_WINDOW,
  isFailure,
  MIN_FRESHNESS_WINDOW,
  nine,
  pcdOf,
  proofBytes,
  QR_DATA,
  SIGNED_AT,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
} from './fixtures';

const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };

/** The reply to a request under a config with `window`, over a QR the stack signs at `SIGNED_AT`. */
async function replyUnder(window: bigint): Promise<Hex | { readonly kind: string }> {
  const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST)) });
  const method = anonAadhaarMethod({ stack: double.stack });
  const ctx = ctxFor(configBytes(22n, 77n, window), DIGEST);

  return method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('replyFrom refuses a QR older than the config window by the system clock', () => {
  it('a QR one second past the window is material-rejected', async () => {
    clockAt(SIGNED_AT + FRESHNESS_WINDOW + 1n);

    expect(isFailure(await replyUnder(FRESHNESS_WINDOW), 'material-rejected')).toBe(true);
  });

  it('a QR years older than the window is material-rejected', async () => {
    clockAt(SIGNED_AT + 100_000_000n);

    expect(isFailure(await replyUnder(FRESHNESS_WINDOW), 'material-rejected')).toBe(true);
  });

  it.each([
    ['ten minutes old', SIGNED_AT + 600n],
    ['exactly the window old', SIGNED_AT + FRESHNESS_WINDOW],
    ['signed this very second', SIGNED_AT],
    ['signed an hour in the future', SIGNED_AT - 3_600n],
  ])('a QR %s proceeds to the proof bytes', async (_age, now) => {
    clockAt(now);

    const reply = await replyUnder(FRESHNESS_WINDOW);

    expect(typeof reply).toBe('string');
    expect(((reply as Hex).length - 2) / 2).toBe(544);
  });

  it('measures the age against the window the request config carries, not a fixed one', async () => {
    clockAt(SIGNED_AT + MIN_FRESHNESS_WINDOW + 1n);

    expect(isFailure(await replyUnder(MIN_FRESHNESS_WINDOW), 'material-rejected')).toBe(true);
    expect(typeof (await replyUnder(FRESHNESS_WINDOW))).toBe('string');
  });

  it('reads the clock in milliseconds and compares whole seconds', async () => {
    clockAt(SIGNED_AT + FRESHNESS_WINDOW, 999);

    expect(typeof (await replyUnder(FRESHNESS_WINDOW))).toBe('string');
  });
});

describe('replyFrom refuses a config window under the minimum before proving', () => {
  it.each([0n, 1n, MIN_FRESHNESS_WINDOW - 1n])('a window of %s seconds is request-unsupported and the prover never runs', async (window) => {
    clockAt(SIGNED_AT + 600n);

    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST)) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(configBytes(22n, 77n, window), DIGEST);

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA }), 'request-unsupported')).toBe(true);
    expect(double.proveCalls).toHaveLength(0);
  });

  it('a window of exactly the minimum proceeds to the proof bytes', async () => {
    clockAt(SIGNED_AT + 600n);

    expect(typeof (await replyUnder(MIN_FRESHNESS_WINDOW))).toBe('string');
  });
});

describe('verify reads no clock', () => {
  it('judges a QR years older than the window by the stack alone, without reading Date.now', async () => {
    const clock = clockAt(SIGNED_AT + 100_000_000n);
    const double = stackDouble({ verify: true });
    const proof = proofBytes({
      a: [1n, 2n],
      b: [
        [4n, 3n],
        [6n, 5n],
      ],
      c: [7n, 8n],
      inputs: nine(signalsFor(22n, 77n, DIGEST)),
    });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctxFor(configBytes(22n, 77n), DIGEST), proof)).toBe('satisfied');
    expect(clock).not.toHaveBeenCalled();
  });
});
