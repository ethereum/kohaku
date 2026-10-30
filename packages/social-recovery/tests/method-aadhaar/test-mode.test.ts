import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import type { ProofWords, Signals } from './fixtures';
import {
  CERTIFICATE,
  clockForFile,
  configBytes,
  ctxFor,
  FRESH_NOW,
  isFailure,
  MIN_FRESHNESS_WINDOW,
  nine,
  pcdOf,
  proofBytes,
  QR_DATA,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
  type DoubleOptions,
} from './fixtures';

const DIGEST: Hex = `0x${'ab'.repeat(32)}`;
const NULLIFIER = 1234n;
const SEED = 42n;
const CTX = ctxFor(configBytes(NULLIFIER, SEED), DIGEST);
const MODES = [false, true] as const;

clockForFile(FRESH_NOW);

const proofWith = (overrides: Partial<Signals> = {}): Hex => {
  const words: ProofWords = {
    a: [1n, 2n],
    b: [
      [4n, 3n],
      [6n, 5n],
    ],
    c: [7n, 8n],
    inputs: nine(signalsFor(NULLIFIER, SEED, DIGEST, overrides)),
  };

  return proofBytes(words);
};

const build = (testMode: boolean | undefined, options: DoubleOptions = {}) => {
  const double = stackDouble(options);
  const method = testMode === undefined ? anonAadhaarMethod({ stack: double.stack }) : anonAadhaarMethod({ stack: double.stack, testMode });

  return { double, method };
};

describe('verify hands the stack the test-mode flag', () => {
  it('by default the stack receives false as the second argument', async () => {
    const { double, method } = build(undefined, { verify: true });

    expect(await method.verify(CTX, proofWith())).toBe('satisfied');
    expect(double.verifyFlags).toEqual([false]);
    expect(double.verifyArities).toEqual([2]);
  });

  it('an explicit testMode: false is the default', async () => {
    const { double, method } = build(false, { verify: true });

    expect(await method.verify(CTX, proofWith())).toBe('satisfied');
    expect(double.verifyFlags).toEqual([false]);
  });

  it('under testMode: true the stack receives true, and its true answer is satisfied', async () => {
    const { double, method } = build(true, { verify: true });

    expect(await method.verify(CTX, proofWith())).toBe('satisfied');
    expect(double.verifyFlags).toEqual([true]);
  });

  it('under testMode: true a false answer is still rejected', async () => {
    const { double, method } = build(true, { verify: false });

    expect(await method.verify(CTX, proofWith())).toBe('rejected');
    expect(double.verifyFlags).toEqual([true]);
  });

  it.each(MODES)('test mode %s: a stack that throws is not-judged', async (testMode) => {
    const { double, method } = build(testMode, { verify: 'throw' });

    expect(await method.verify(CTX, proofWith())).toBe('not-judged');
    expect(double.verifyFlags).toEqual([testMode]);
  });

  it('with no stack at all, test mode answers not-judged as the default does', async () => {
    expect(await anonAadhaarMethod({ testMode: true }).verify(CTX, proofWith())).toBe('not-judged');
  });
});

describe.each(MODES)('test mode %s: the checks before the stack are unchanged', (testMode) => {
  it.each([
    ['a nullifier mismatch', { nullifier: NULLIFIER + 1n }],
    ['a seed mismatch', { nullifierSeed: SEED + 1n }],
    ['a signal hash for another digest', { signalHash: 0n }],
    ['a disclosed field', { gender: 77n }],
  ])('%s is rejected without any stack call', async (_why, overrides) => {
    const { double, method } = build(testMode, { verify: true });

    expect(await method.verify(CTX, proofWith(overrides))).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it('undecodable proof bytes and a window under one hour are rejected without any stack call', async () => {
    const { double, method } = build(testMode, { verify: true });

    expect(await method.verify(CTX, '0x')).toBe('rejected');
    expect(await method.verify(ctxFor(configBytes(NULLIFIER, SEED, MIN_FRESHNESS_WINDOW - 1n), DIGEST), proofWith())).toBe('rejected');
    expect(double.total()).toBe(0);
  });
});

describe.each(MODES)('test mode %s: replyFrom\'s local verdict carries the flag', (testMode) => {
  const digest: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
  const config = configBytes(22n, 77n);
  const params = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
  const pcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, digest));

  it('a stack answering true returns the proof, and the stack saw the mode', async () => {
    const { double, method } = build(testMode, { pcd, verify: true });
    const ctx = ctxFor(config, digest);
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, params), { qrData: QR_DATA });

    expect(typeof reply).toBe('string');
    expect(double.verifyFlags).toEqual([testMode]);
  });

  it('a stack answering false is material-rejected', async () => {
    const { method } = build(testMode, { pcd, verify: false });
    const ctx = ctxFor(config, digest);

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, params), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
  });
});

describe('the factory\'s option combinations', () => {
  const artifacts = { wasmURL: 'w', zkeyURL: 'z', vkeyURL: 'v', artifactsOrigin: 'server' } as const;

  it('allows { stack, testMode } and { artifacts, testMode }, and still refuses { stack, artifacts }', () => {
    expect(() => anonAadhaarMethod({ stack: stackDouble().stack, testMode: true })).not.toThrow();
    expect(() => anonAadhaarMethod({ artifacts, testMode: true })).not.toThrow();
    expect(() => anonAadhaarMethod({ testMode: false })).not.toThrow();
    expect(() => anonAadhaarMethod({ stack: stackDouble().stack, artifacts })).toThrow(TypeError);
    expect(() => anonAadhaarMethod({ stack: stackDouble().stack, artifacts, testMode: true })).toThrow(TypeError);
  });
});
