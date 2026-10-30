import { afterEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_SIGNED_AT_SLACK } from '../../src/constants/method-aadhaar';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  CERTIFICATE,
  clockAt,
  configBytes,
  ctxFor,
  FRESH_NOW,
  FRESHNESS_WINDOW,
  isFailure,
  MIN_FRESHNESS_WINDOW,
  pcdOf,
  QR_DATA,
  SIGNED_AT,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
  type Stack,
  type StackDouble,
} from './fixtures';

const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };

/** The latest clock the pre-prover read lets through for a QR signed at `SIGNED_AT` under the 24-hour window. */
const LAST_LET_THROUGH = SIGNED_AT + FRESHNESS_WINDOW + METHOD_AADHAAR_SIGNED_AT_SLACK;

type Read = bigint | undefined | 'throw';

type Harness = { readonly double: StackDouble; readonly stack: Stack; readonly reads: string[] };

/** A double whose proof the QR signs at `pcdSignedAt`, with a `signedAt` answering `read`, or none where `read` is `'absent'`. */
function harness(read: Read | 'absent', pcdSignedAt: bigint = SIGNED_AT): Harness {
  const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { timestamp: pcdSignedAt })) });
  const reads: string[] = [];

  if (read === 'absent') return { double, stack: double.stack, reads };

  const signedAt = (qrData: string): Promise<bigint | undefined> => {
    reads.push(qrData);

    return read === 'throw' ? Promise.reject(new Error('incorrect header check')) : Promise.resolve(read);
  };

  return { double, stack: { ...double.stack, signedAt }, reads };
}

async function replyWith(stack: Stack, window: bigint = FRESHNESS_WINDOW, material: { readonly signal?: AbortSignal } = {}) {
  const method = anonAadhaarMethod({ stack });
  const ctx = ctxFor(configBytes(22n, 77n, window), DIGEST);

  return method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, ...material });
}

const isProof = (reply: unknown): boolean => typeof reply === 'string' && (reply.length - 2) / 2 === 544;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('replyFrom refuses a QR the stack reads as long expired before proving', () => {
  it('a QR older than the window by more than the slack is material-rejected and generateArgs is never called', async () => {
    clockAt(LAST_LET_THROUGH + 1n);

    const { double, stack, reads } = harness(SIGNED_AT);

    expect(isFailure(await replyWith(stack), 'material-rejected')).toBe(true);
    expect(reads).toEqual([QR_DATA]);
    expect(double.generateArgsCalls).toHaveLength(0);
    expect(double.proveCalls).toHaveLength(0);
    expect(double.total()).toBe(0);
  });

  it('measures the age against the request config\'s window plus the slack', async () => {
    clockAt(SIGNED_AT + MIN_FRESHNESS_WINDOW + METHOD_AADHAAR_SIGNED_AT_SLACK + 1n);

    const short = harness(SIGNED_AT);
    const long = harness(SIGNED_AT);

    expect(isFailure(await replyWith(short.stack, MIN_FRESHNESS_WINDOW), 'material-rejected')).toBe(true);
    expect(short.double.generateArgsCalls).toHaveLength(0);
    expect(isProof(await replyWith(long.stack))).toBe(true);
    expect(long.double.generateArgsCalls).toHaveLength(1);
  });
});

describe('replyFrom lets the prover run, and isFresh judge, every other read', () => {
  it.each([
    ['read a second younger than its proof\'s time', LAST_LET_THROUGH + 1n, SIGNED_AT + 1n],
    ['read as signed after now', SIGNED_AT + FRESHNESS_WINDOW + METHOD_AADHAAR_SIGNED_AT_SLACK + 10n, LAST_LET_THROUGH + 3_600n],
    ['read as undefined', LAST_LET_THROUGH + 1n, undefined],
    ['a read that rejects', LAST_LET_THROUGH + 1n, 'throw'],
  ] as const)('a QR %s whose proof carries a stale time reaches the prover, then isFresh refuses it', async (_case, now, read) => {
    clockAt(now);

    const { double, stack } = harness(read);

    expect(isFailure(await replyWith(stack), 'material-rejected')).toBe(true);
    expect(double.generateArgsCalls).toHaveLength(1);
    expect(double.proveCalls).toHaveLength(1);
    expect(double.verifyCalls).toHaveLength(0);
  });

  it.each([
    ['inside the window', SIGNED_AT],
    ['in the future', FRESH_NOW + 100_000n],
    ['unread', undefined],
  ] as const)('a QR read as %s over a fresh proof gives the proof bytes', async (_case, read) => {
    clockAt(FRESH_NOW);

    const { double, stack } = harness(read);

    expect(isProof(await replyWith(stack))).toBe(true);
    expect(double.order).toEqual(['generateArgs', 'prove', 'verify']);
  });

  it('a QR read exactly the window plus the slack old passes the pre-read and isFresh alike', async () => {
    clockAt(LAST_LET_THROUGH);

    const { double, stack } = harness(SIGNED_AT);

    expect(isProof(await replyWith(stack))).toBe(true);
    expect(double.order).toEqual(['generateArgs', 'prove', 'verify']);
  });

  it('a read saying fresh does not save a proof whose own time isFresh refuses', async () => {
    const now = LAST_LET_THROUGH + 100n;

    clockAt(now);

    const { double, stack } = harness(now);

    expect(isFailure(await replyWith(stack), 'material-rejected')).toBe(true);
    expect(double.proveCalls).toHaveLength(1);
  });

  it('a stack without signedAt still proves, an expired QR then refused by isFresh alone', async () => {
    clockAt(LAST_LET_THROUGH + 1n);

    const { double, stack } = harness('absent');

    expect('signedAt' in stack).toBe(false);
    expect(isFailure(await replyWith(stack), 'material-rejected')).toBe(true);
    expect(double.generateArgsCalls).toHaveLength(1);
  });

  it('a stack without signedAt over a fresh QR gives the proof bytes', async () => {
    clockAt(FRESH_NOW);

    expect(isProof(await replyWith(harness('absent').stack))).toBe(true);
  });
});

describe('the pre-prover read sits after the earlier refusals', () => {
  it('a config window under the minimum is request-unsupported whatever the QR\'s time', async () => {
    clockAt(LAST_LET_THROUGH + 1n);

    const { double, stack } = harness(SIGNED_AT);

    expect(isFailure(await replyWith(stack, MIN_FRESHNESS_WINDOW - 1n), 'request-unsupported')).toBe(true);
    expect(double.total()).toBe(0);
  });

  it('an already aborted signal is device-refused whatever the QR\'s time', async () => {
    clockAt(LAST_LET_THROUGH + 1n);

    const { double, stack } = harness(SIGNED_AT);
    const controller = new AbortController();

    controller.abort();

    expect(isFailure(await replyWith(stack, FRESHNESS_WINDOW, { signal: controller.signal }), 'device-refused')).toBe(true);
    expect(double.total()).toBe(0);
  });

  it('a signal aborted while signedAt is pending settles the reply as device-refused', async () => {
    clockAt(FRESH_NOW);

    const { double, stack: base } = harness(SIGNED_AT);
    const controller = new AbortController();
    const signedAt = (): Promise<bigint | undefined> => new Promise(() => undefined);
    const reply = replyWith({ ...base, signedAt }, FRESHNESS_WINDOW, { signal: controller.signal });

    controller.abort();

    expect(isFailure(await reply, 'device-refused')).toBe(true);
    expect(double.total()).toBe(0);
  });
});

describe('verify makes no time read', () => {
  it('the local verdict never calls signedAt', async () => {
    const { stack, reads } = harness(SIGNED_AT);
    const method = anonAadhaarMethod({ stack });
    const ctx = ctxFor(configBytes(22n, 77n), DIGEST);

    clockAt(FRESH_NOW);

    const reply = await replyWith(harness(undefined).stack);

    expect(isProof(reply)).toBe(true);
    expect(await method.verify(ctx, reply as Hex)).toBe('satisfied');
    expect(reads).toEqual([]);
  });
});
