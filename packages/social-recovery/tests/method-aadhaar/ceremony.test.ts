import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../../src/constants';
import { METHOD_AADHAAR_FRESHNESS_WINDOW } from '../../src/constants/method-aadhaar';
import type { EnrollInput, Hex, Input, Material } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  CERTIFICATE,
  clockForFile,
  configBytes,
  configRow,
  ctxFor,
  FRESH_NOW,
  FRESHNESS_WINDOW,
  isFailure,
  pcdOf,
  proofRow,
  QR_DATA,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
  vectorPcd,
} from './fixtures';

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const CONFIG = configBytes(22n, 77n);
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
/** The error the peer's chunk download throws where the browser offers no storage. */
const STORAGE_FAILURE = 'No available storage method found.';
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

describe('enrollment', () => {
  it('enrollInput carries the seed and the certificate and no field to reveal, touching no stack', () => {
    const double = stackDouble();
    const input = anonAadhaarMethod({ stack: double.stack }).enrollInput(PARAMS);

    expect(input.kind).toBe('ceremony');
    expect(Object.values(input)).toContain(CERTIFICATE);
    expect(Object.values(input).some((value) => value === 77n || value === 77)).toBe(true);
    expect(Object.values(input).filter(Array.isArray)).toEqual([[]]);
    expect((input as { fieldsToRevealArray?: unknown }).fieldsToRevealArray).toEqual([]);
    expect(double.total()).toBe(0);
  });

  it('configFrom writes abi.encode(nullifier, seed, the fixed window) from the prover proof', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST)) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(METHOD_AADHAAR_FRESHNESS_WINDOW).toBe(FRESHNESS_WINDOW);
    expect(config).toBe(configBytes(22n, 77n, 86_400n));
    expect(method.codec.decodeConfig(config as Hex)).toEqual({ nullifier: 22n, nullifierSeed: 77n, freshnessWindow: 86_400n });
  });

  it('configFrom writes the config vector bytes but for the window, which the vector sets to 4500', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST)) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const config = (await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA })) as Hex;
    const twoWords = 2 + 2 * 64;

    expect(config.slice(0, twoWords)).toBe(configRow.expected.encoded.slice(0, twoWords));
    expect(BigInt(`0x${configRow.expected.encoded.slice(twoWords)}`)).toBe(4_500n);
    expect(config).toBe(configBytes(22n, 77n, METHOD_AADHAAR_FRESHNESS_WINDOW));
  });

  it('configFrom proves once and hands the prover the QR code, the seed and the certificate, no reveal', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });

    await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(double.generateArgsCalls).toHaveLength(1);
    expect(double.proveCalls).toHaveLength(1);

    const options = double.generateArgsCalls[0];

    expect(options?.qrData).toBe(QR_DATA);
    expect(options?.certificateFile).toBe(CERTIFICATE);
    expect(BigInt(options?.nullifierSeed ?? -1n)).toBe(77n);
    expect(options?.fieldsToRevealArray ?? []).toEqual([]);
    expect(options?.signal === undefined ? undefined : BigInt(options.signal)).not.toBe(BigInt(DIGEST));
  });

  it('configFrom refuses a proof made under another seed than the input carries', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 78n, DIGEST)) });
    const method = anonAadhaarMethod({ stack: double.stack });

    expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
  });

  it('configFrom maps a failed generateArgs or prove to material-rejected', async () => {
    for (const failing of [{ generateArgs: 'throw' as const }, { prove: 'throw' as const }]) {
      const method = anonAadhaarMethod({ stack: stackDouble(failing).stack });

      expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    }
  });

  it('configFrom under the default bucket proves through the peer, initialised once with the chunked bucket', async () => {
    core.prove.mockResolvedValueOnce(boundPcd);

    const method = anonAadhaarMethod();

    expect(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA })).toBe(configBytes(22n, 77n, METHOD_AADHAAR_FRESHNESS_WINDOW));
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.generateArgs).toHaveBeenCalledTimes(1);
    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('configFrom through an injected adapter whose own init rejects is device-unavailable, the prover never called', async () => {
    core.init.mockRejectedValueOnce(new Error('adapter: init refused'));

    const method = anonAadhaarMethod();

    expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'device-unavailable')).toBe(true);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });

  it('configFrom under the default bucket whose storage fails inside the peer\'s prove, after init and generateArgs, is material-rejected', async () => {
    core.prove.mockRejectedValueOnce(new Error(STORAGE_FAILURE));

    const method = anonAadhaarMethod();

    expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.generateArgs).toHaveBeenCalledTimes(1);
    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('configFrom aborted while proving is device-refused', async () => {
    const double = stackDouble({ prove: 'hang' });
    const method = anonAadhaarMethod({ stack: double.stack });
    const controller = new AbortController();
    const pending = method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, signal: controller.signal });

    await double.proving;
    controller.abort();

    expect(isFailure(await pending, 'device-refused')).toBe(true);
    expect(double.proveCalls[0]?.signal).toBe(controller.signal);
  });
});

describe('signing', () => {
  it('signingInput carries the seed, the certificate, no reveal and the digest as signal, touching no stack', () => {
    const double = stackDouble();
    const input = anonAadhaarMethod({ stack: double.stack }).signingInput(ctxFor(CONFIG, DIGEST), PARAMS);
    const values = Object.values(input);

    expect(values).toContain(CERTIFICATE);
    expect(values.some((value) => value === 77n || value === 77)).toBe(true);
    expect(values.filter(Array.isArray)).toEqual([[]]);
    expect((input as { fieldsToRevealArray?: unknown }).fieldsToRevealArray).toEqual([]);
    expect(values.some((value) => (typeof value === 'string' || typeof value === 'bigint') && safeBig(value) === BigInt(DIGEST))).toBe(true);
    expect(double.total()).toBe(0);
  });

  it('signingInput refuses, by throwing before any device is asked, a seed other than the config one', () => {
    const double = stackDouble();
    const method = anonAadhaarMethod({ stack: double.stack });

    expect(() => method.signingInput(ctxFor(CONFIG, DIGEST), { ...PARAMS, nullifierSeed: 78n })).toThrow();
    expect(double.total()).toBe(0);
  });

  it('replyFrom hands the prover the QR code, the same seed and certificate, the digest and the page progress and signal', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(CONFIG, DIGEST);
    const controller = new AbortController();
    const states: string[] = [];
    const onProgress = (state: string): void => {
      states.push(state);
    };

    await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, onProgress, signal: controller.signal });

    const options = double.generateArgsCalls[0];

    expect(options?.qrData).toBe(QR_DATA);
    expect(options?.certificateFile).toBe(CERTIFICATE);
    expect(BigInt(options?.nullifierSeed ?? -1n)).toBe(77n);
    expect(options?.fieldsToRevealArray ?? []).toEqual([]);
    expect(BigInt(options?.signal ?? '-1')).toBe(BigInt(DIGEST));
    expect(double.proveCalls).toHaveLength(1);
    expect(double.proveCalls[0]?.onProgress).toBe(onProgress);
    expect(double.proveCalls[0]?.signal).toBe(controller.signal);
    expect(states).toEqual(['proving', 'completed']);
    expect(double.order.slice(0, 2)).toEqual(['generateArgs', 'prove']);
  });

  it('replyFrom reproduces the blessed proof bytes from the vector upstream proof', async () => {
    const double = stackDouble({ pcd: vectorPcd(proofRow) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(configBytes(22n, 77n), proofRow.input.digest);
    const proof = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(proof).toBe(proofRow.expected.encoded);
    expect(((proof as Hex).length - 2) / 2).toBe(544);
  });

  it('replyFrom refuses a proof whose nullifier is not the config one, a failed prove and a false local verify', async () => {
    const ctx = ctxFor(CONFIG, DIGEST);
    const cases = [
      stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(23n, 77n, DIGEST)) }),
      stackDouble({ prove: 'throw' }),
      stackDouble({ generateArgs: 'throw' }),
      stackDouble({ pcd: boundPcd, verify: false }),
      stackDouble({ pcd: { proof: { groth16Proof: { pi_a: [], pi_b: [], pi_c: [] } } } as never }),
    ];

    for (const double of cases) {
      const method = anonAadhaarMethod({ stack: double.stack });

      expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    }
  });

  it('replyFrom refuses an input whose seed is not the config one before proving', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const otherInput = method.signingInput(ctxFor(configBytes(22n, 78n), DIGEST), { ...PARAMS, nullifierSeed: 78n });
    const reply = await method.replyFrom(ctxFor(CONFIG, DIGEST), otherInput, { qrData: QR_DATA });

    expect(isFailure(reply, 'material-rejected')).toBe(true);
    expect(double.proveCalls).toHaveLength(0);
  });

  it('replyFrom under the default bucket proves through the peer, initialised once with the chunked bucket', async () => {
    core.prove.mockResolvedValueOnce(boundPcd);

    const method = anonAadhaarMethod();
    const ctx = ctxFor(CONFIG, DIGEST);
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(typeof reply).toBe('string');
    expect(((reply as Hex).length - 2) / 2).toBe(544);
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('replyFrom under the default bucket whose storage fails inside the peer\'s prove, after init and generateArgs, is material-rejected', async () => {
    core.prove.mockRejectedValueOnce(new Error(STORAGE_FAILURE));

    const method = anonAadhaarMethod();
    const ctx = ctxFor(CONFIG, DIGEST);

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.generateArgs).toHaveBeenCalledTimes(1);
    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('verify on a proof under the default bucket answers what the peer\'s verify answers, a failing prove storage notwithstanding', async () => {
    core.prove.mockImplementation(() => Promise.reject(new Error(STORAGE_FAILURE)));
    core.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    try {
      const method = anonAadhaarMethod();
      const ctx = ctxFor(CONFIG, DIGEST);
      const proof = await anonAadhaarMethod({ stack: stackDouble({ pcd: boundPcd }).stack }).replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

      expect(typeof proof).toBe('string');
      expect(await method.verify(ctx, proof as Hex)).toBe('satisfied');
      expect(await method.verify(ctx, proof as Hex)).toBe('rejected');
      expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
      expect(core.prove).not.toHaveBeenCalled();
      expect(core.verify).toHaveBeenCalledTimes(2);
    } finally {
      core.prove.mockImplementation(() => Promise.resolve({}));
    }
  });

  it.each(['hang', 'hang-until-aborted'] as const)('replyFrom aborted during a prove that does %s is device-refused', async (prove) => {
    const double = stackDouble({ prove });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(CONFIG, DIGEST);
    const controller = new AbortController();
    const pending = method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: controller.signal });

    await double.proving;
    await tick();
    controller.abort();

    expect(isFailure(await pending, 'device-refused')).toBe(true);
    expect(double.proveCalls[0]?.signal).toBe(controller.signal);
  });

  it('replyFrom with a signal already aborted is device-refused', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(CONFIG, DIGEST);

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: AbortSignal.abort() }), 'device-refused')).toBe(true);
  });
});

describe('never a throw from the typed members', () => {
  const ctx = ctxFor(CONFIG, DIGEST);
  const materials: readonly Material[] = [
    undefined,
    {},
    { qrData: 5 },
    { qrData: '' },
    { qrData: QR_DATA, onProgress: 3 },
    { qrData: QR_DATA, signal: {} },
  ];
  const inputs: readonly unknown[] = [undefined, null, {}, { nullifierSeed: 'x' }, { nullifierSeed: -1n, certificateFile: CERTIFICATE }];

  it('replyFrom resolves to a typed failure on every malformed material, input or ctx', async () => {
    const method = anonAadhaarMethod({ stack: stackDouble({ pcd: boundPcd }).stack });
    const input = method.signingInput(ctx, PARAMS);
    const replies = [
      ...materials.map((material) => method.replyFrom(ctx, input, material)),
      ...inputs.map((bad) => method.replyFrom(ctx, bad as Input, { qrData: QR_DATA })),
      method.replyFrom(ctxFor('0x1234', DIGEST), input, { qrData: QR_DATA }),
      method.replyFrom(ctxFor(CONFIG, '0x12'), input, { qrData: QR_DATA }),
    ];

    for (const reply of await Promise.all(replies)) expect((reply as { kind?: string }).kind).toBe('reply-failure');
  });

  it('configFrom resolves to a typed failure on every malformed material or input', async () => {
    const method = anonAadhaarMethod({ stack: stackDouble({ pcd: boundPcd }).stack });
    const input = method.enrollInput(PARAMS);
    const results = [
      ...materials.map((material) => method.configFrom(input, material)),
      ...inputs.map((bad) => method.configFrom(bad as EnrollInput, { qrData: QR_DATA })),
      method.configFrom({ kind: 'nothing-to-perform' }, { qrData: QR_DATA }),
    ];

    for (const result of await Promise.all(results)) expect((result as { kind?: string }).kind).toBe('reply-failure');
  });
});

function safeBig(value: string | bigint): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}
