import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KitRefusalError } from '../../src/client-core';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../../src/constants';
import type { Hex, Material } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  CERTIFICATE,
  clockForFile,
  configBytes,
  ctxFor,
  FRESH_NOW,
  isFailure,
  pcdOf,
  QR_DATA,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
  type UpstreamProof,
} from './fixtures';

const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const CONFIG = configBytes(22n, 77n);
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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

clockForFile(FRESH_NOW);

/** The error `run` throws, or `undefined` when it returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe('the nullifier seed in the parameters', () => {
  const method = anonAadhaarMethod({ stack: stackDouble().stack });
  const ctx = ctxFor(CONFIG, DIGEST);

  it.each([
    ['-1', -1n],
    ['the circuit field itself', FIELD],
    ['2^256', 1n << 256n],
  ])('a seed of %s is a RangeError from enrollInput and from signingInput', (_label, nullifierSeed) => {
    expect(thrown(() => method.enrollInput({ ...PARAMS, nullifierSeed }))).toBeInstanceOf(RangeError);
    expect(thrown(() => method.signingInput(ctx, { ...PARAMS, nullifierSeed }))).toBeInstanceOf(RangeError);
  });

  it.each([
    ['a decimal string', '77'],
    ['a hex string', '0x4d'],
    ['null', null],
    ['a fraction', 77.5],
    ['missing', undefined],
  ])('a seed that is %s is a TypeError from enrollInput and from signingInput', (_label, nullifierSeed) => {
    expect(thrown(() => method.enrollInput({ ...PARAMS, nullifierSeed } as never))).toBeInstanceOf(TypeError);
    expect(thrown(() => method.signingInput(ctx, { ...PARAMS, nullifierSeed } as never))).toBeInstanceOf(TypeError);
  });

  it('the largest seed inside the field is accepted', () => {
    expect(() => method.enrollInput({ ...PARAMS, nullifierSeed: FIELD - 1n })).not.toThrow();
  });

  it('an empty certificate is a TypeError', () => {
    expect(thrown(() => method.enrollInput({ ...PARAMS, issuerCertificate: '' }))).toBeInstanceOf(TypeError);
    expect(thrown(() => method.signingInput(ctx, { ...PARAMS, issuerCertificate: '  ' }))).toBeInstanceOf(TypeError);
  });
});

describe('signingInput under a seed other than the config one', () => {
  it('is a TypeError, not a refusal of the kit and not a plain Error, and no stack is touched', () => {
    const double = stackDouble();
    const method = anonAadhaarMethod({ stack: double.stack });
    const error = thrown(() => method.signingInput(ctxFor(CONFIG, DIGEST), { ...PARAMS, nullifierSeed: 78n }));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(KitRefusalError);
    expect((error as Error).message).toContain('nullifierSeed');
    expect(double.total()).toBe(0);
  });

  it('a seed that matches the config passes', () => {
    const method = anonAadhaarMethod({ stack: stackDouble().stack });

    expect(() => method.signingInput(ctxFor(CONFIG, DIGEST), PARAMS)).not.toThrow();
  });
});

type MutableUpstream = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

/** The upstream proof with one slot left empty by `punch`, the projective coordinates of the stack kept. */
function holedPcd(punch: (proof: MutableUpstream) => void): ReturnType<typeof pcdOf> {
  const pcd = pcdOf(SYNTHETIC_UPSTREAM as UpstreamProof, signalsFor(22n, 77n, DIGEST));
  const groth16 = pcd.proof.groth16Proof as unknown as MutableUpstream;
  const copy: MutableUpstream = {
    pi_a: [...groth16.pi_a],
    pi_b: groth16.pi_b.map((pair) => [...pair]),
    pi_c: [...groth16.pi_c],
  };

  punch(copy);

  return { proof: { ...pcd.proof, groth16Proof: { ...pcd.proof.groth16Proof, ...copy } } } as typeof pcd;
}

/** Leaves `list[index]` empty while keeping the length. */
function punchAt(list: string[], index: number): void {
  const kept = list.map((value, at) => (at === index ? undefined : value));

  list.length = 0;
  kept.forEach((value, at) => {
    if (value !== undefined) list[at] = value;
  });
  list.length = kept.length;
}

describe('a hole in the proof the stack returns is material-rejected, never a zero word', () => {
  it.each([
    ['pi_a[0]', (proof: MutableUpstream) => punchAt(proof.pi_a, 0)],
    ['pi_a[1]', (proof: MutableUpstream) => punchAt(proof.pi_a, 1)],
    ['pi_c[1]', (proof: MutableUpstream) => punchAt(proof.pi_c, 1)],
    ['pi_b[0][1]', (proof: MutableUpstream) => punchAt(proof.pi_b[0] ?? [], 1)],
    ['pi_b[1][0]', (proof: MutableUpstream) => punchAt(proof.pi_b[1] ?? [], 0)],
  ])('a hole at %s: replyFrom and configFrom answer the typed failure', async (_label, punch) => {
    const method = anonAadhaarMethod({ stack: stackDouble({ pcd: holedPcd(punch) }).stack });
    const ctx = ctxFor(CONFIG, DIGEST);
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'material-rejected')).toBe(true);
    expect(isFailure(config, 'material-rejected')).toBe(true);
  });

  it('the same proof without the hole is answered with proof bytes', async () => {
    const method = anonAadhaarMethod({ stack: stackDouble({ pcd: holedPcd(() => undefined) }).stack });
    const ctx = ctxFor(CONFIG, DIGEST);

    expect(typeof (await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA }))).toBe('string');
  });
});

describe('every typed failure the method answers is frozen', () => {
  const ctx = ctxFor(CONFIG, DIGEST);
  const cases: readonly (readonly [string, Material, Parameters<typeof stackDouble>[0]])[] = [
    ['material-rejected for a missing QR code', {}, {}],
    ['device-refused for an aborted signal', { qrData: QR_DATA, signal: AbortSignal.abort() }, {}],
    ['material-rejected for a failed prove', { qrData: QR_DATA }, { prove: 'throw' }],
  ];

  it.each(cases)('%s', async (_label, material, options) => {
    const method = anonAadhaarMethod({ stack: stackDouble(options).stack });
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material);
    const config = await method.configFrom(method.enrollInput(PARAMS), material);

    expect((reply as { kind?: string }).kind).toBe('reply-failure');
    expect(Object.isFrozen(reply)).toBe(true);
    expect((config as { kind?: string }).kind).toBe('reply-failure');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('material-rejected under the default bucket whose storage fails inside the peer\'s prove, after init and generateArgs, is frozen', async () => {
    core.prove.mockRejectedValueOnce(new Error('No available storage method found.'));

    const method = anonAadhaarMethod();
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'material-rejected')).toBe(true);
    expect(Object.isFrozen(reply)).toBe(true);
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.generateArgs).toHaveBeenCalledTimes(1);
    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('device-unavailable through an injected adapter whose own init rejects is frozen, the prover never called', async () => {
    core.init.mockRejectedValueOnce(new Error('adapter: init refused'));

    const method = anonAadhaarMethod();
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'device-unavailable')).toBe(true);
    expect(Object.isFrozen(reply)).toBe(true);
    expect(core.prove).not.toHaveBeenCalled();
  });
});
