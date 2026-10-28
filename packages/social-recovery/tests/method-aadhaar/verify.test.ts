import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../../src/constants';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import type { ProofWords, Signals } from './fixtures';
import { configBytes, configRow, ctxFor, MIN_FRESHNESS_WINDOW, nine, proofBytes, proofRow, signalsFor, stackDouble } from './fixtures';

const DIGEST: Hex = `0x${'ab'.repeat(32)}`;
const NULLIFIER = 1234n;
const SEED = 42n;
const CTX = ctxFor(configBytes(NULLIFIER, SEED), DIGEST);

const core = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.resolve()),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn<(pcd: unknown, testMode?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
}));

/** The peer, stubbed so the default bucket never reaches the network. */
vi.mock('@anon-aadhaar/core', () => ({
  ...core,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
  productionPublicKeyHash: '18063425702624337643644061197836918910810808173893535653269228433734128853484',
  testPublicKeyHash: '15134874015316324267425466444584014077184337590635665158241104437045239495873',
}));

/** What the peer's init receives for the default bucket. */
const CHUNKED_INIT = { ...METHOD_AADHAAR_BUCKET_CHUNKED, artifactsOrigin: 2 };

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('bindings refused without any stack call', () => {
  it.each([
    ['nullifier', { nullifier: NULLIFIER + 1n }],
    ['nullifier seed', { nullifierSeed: SEED + 1n }],
    ['signal hash', { signalHash: 0n }],
    ['nullifier and seed swapped', { nullifier: SEED, nullifierSeed: NULLIFIER }],
  ])('a %s mismatch is rejected', async (_label, overrides) => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith(overrides))).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it('a proof for another digest is rejected', async () => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctxFor(configBytes(NULLIFIER, SEED), `0x${'cd'.repeat(32)}`), proofWith())).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it.each([
    ['empty bytes', '0x'],
    ['543 bytes', proofWith().slice(0, -2)],
    ['a tenth input', `${proofWith()}${'00'.repeat(32)}`],
  ])('undecodable proof bytes (%s) are rejected, never thrown', async (_label, bytes) => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, bytes as Hex)).toBe('rejected');
    expect(double.total()).toBe(0);
  });
});

describe('the static checks the method makes without a clock', () => {
  it.each([
    ['ageAbove18', { ageAbove18: 1n }],
    ['gender', { gender: 77n }],
    ['pincode', { pincode: 110_001n }],
    ['state', { state: 1n }],
  ])('a proof disclosing %s is rejected without any stack call', async (_field, overrides) => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith(overrides))).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it.each([0n, 1n, MIN_FRESHNESS_WINDOW - 1n])('a config whose window is %s seconds, under one hour, is rejected without any stack call', async (window) => {
    const double = stackDouble({ verify: true });
    const ctx = ctxFor(configBytes(NULLIFIER, SEED, window), DIGEST);

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctx, proofWith())).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it.each([MIN_FRESHNESS_WINDOW, 4_500n, (1n << 256n) - 1n])('a config whose window is %s seconds is judged by the stack', async (window) => {
    const double = stackDouble({ verify: true });
    const ctx = ctxFor(configBytes(NULLIFIER, SEED, window), DIGEST);

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctx, proofWith())).toBe('satisfied');
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('the two-word config of the earlier layout is rejected without any stack call', async () => {
    const double = stackDouble({ verify: true });
    const twoWords = configBytes(NULLIFIER, SEED).slice(0, 2 + 2 * 64) as Hex;

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctxFor(twoWords, DIGEST), proofWith())).toBe('rejected');
    expect(double.total()).toBe(0);
  });
});

describe('a consistent proof', () => {
  it('under the default bucket reaches the peer, initialised with the chunked bucket, and its true answer is satisfied', async () => {
    expect(await anonAadhaarMethod().verify(CTX, proofWith())).toBe('satisfied');
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.init).toHaveBeenCalledWith(CHUNKED_INIT);
    expect(core.verify).toHaveBeenCalledTimes(1);
  });

  it('under the default bucket is not-judged when the peer cannot reach its vkey', async () => {
    core.verify.mockRejectedValueOnce(new Error('vkey.json: fetch failed'));

    expect(await anonAadhaarMethod().verify(CTX, proofWith())).toBe('not-judged');
    expect(core.init).toHaveBeenCalledWith(CHUNKED_INIT);
  });

  it.each([
    [true, 'satisfied'],
    [false, 'rejected'],
  ] as const)('under the default bucket, where storage fails only inside the peer\'s prove, the peer\'s verify answering %s is %s', async (answer, verdict) => {
    core.prove.mockImplementation(() => Promise.reject(new Error('No available storage method found.')));
    core.verify.mockResolvedValueOnce(answer);

    try {
      expect(await anonAadhaarMethod().verify(CTX, proofWith())).toBe(verdict);
      expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
      expect(core.verify).toHaveBeenCalledTimes(1);
      expect(core.prove).not.toHaveBeenCalled();
    } finally {
      core.prove.mockImplementation(() => Promise.resolve({}));
    }
  });

  it('with a stack that throws on the issuer key is not-judged', async () => {
    const double = stackDouble({ verify: 'throw' });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith())).toBe('not-judged');
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('with a stack answering false is rejected, true is satisfied, and no prover runs', async () => {
    const no = stackDouble({ verify: false });
    const yes = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: no.stack }).verify(CTX, proofWith())).toBe('rejected');
    expect(await anonAadhaarMethod({ stack: yes.stack }).verify(CTX, proofWith())).toBe('satisfied');
    expect([...no.order, ...yes.order]).toEqual(['verify', 'verify']);
  });

  it('hands the stack the nine signals by name and pi_b back in snarkjs order', async () => {
    const double = stackDouble({ verify: true });

    await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith());

    const proof = double.verifyCalls[0]?.proof;

    expect(proof?.nullifier).toBe(NULLIFIER.toString());
    expect(proof?.nullifierSeed).toBe(SEED.toString());
    expect(proof?.pubkeyHash).toBe('99');
    expect(proof?.timestamp).toBe('1700000000');
    expect(proof?.signalHash).toBe(signalsFor(NULLIFIER, SEED, DIGEST).signalHash.toString());
    expect(proof?.groth16Proof.pi_a.slice(0, 2)).toEqual(['1', '2']);
    expect(proof?.groth16Proof.pi_b.slice(0, 2)).toEqual([
      ['3', '4'],
      ['5', '6'],
    ]);
    expect(proof?.groth16Proof.pi_c.slice(0, 2)).toEqual(['7', '8']);
  });
});

describe('the blessed proof row', () => {
  it('binds under the blessed config and its digest: not-judged under the default bucket whose peer throws, satisfied by a stack answering true', async () => {
    const bound = ctxFor(configRow.expected.encoded, proofRow.input.digest);
    const double = stackDouble({ verify: true });

    core.verify.mockRejectedValueOnce(new Error('vkey.json: fetch failed'));

    expect(await anonAadhaarMethod().verify(bound, proofRow.expected.encoded)).toBe('not-judged');
    expect(core.init).toHaveBeenCalledWith(CHUNKED_INIT);
    expect(await anonAadhaarMethod({ stack: double.stack }).verify(bound, proofRow.expected.encoded)).toBe('satisfied');
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('is rejected under another seed and under a window below one hour', async () => {
    const digest = proofRow.input.digest;

    expect(await anonAadhaarMethod().verify(ctxFor(configBytes(22n, 78n, 4_500n), digest), proofRow.expected.encoded)).toBe('rejected');
    expect(await anonAadhaarMethod().verify(ctxFor(configBytes(22n, 77n, 3_599n), digest), proofRow.expected.encoded)).toBe('rejected');
    expect(core.init).not.toHaveBeenCalled();
  });
});
