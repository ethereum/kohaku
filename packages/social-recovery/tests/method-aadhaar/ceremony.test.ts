import { describe, expect, it } from 'vitest';
import type { EnrollInput, Hex, Input, Material } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  CERTIFICATE,
  configBytes,
  configRow,
  ctxFor,
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
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('enrollment', () => {
  it('enrollInput carries the seed and the certificate and no field to reveal, touching no stack', () => {
    const double = stackDouble();
    const input = anonAadhaarMethod({ stack: double.stack }).enrollInput(PARAMS);

    expect(input.kind).toBe('ceremony');
    expect(Object.values(input)).toContain(CERTIFICATE);
    expect(Object.values(input).some((value) => value === 77n || value === 77)).toBe(true);
    expect(Object.values(input).filter(Array.isArray)).toEqual([[]]);
    expect(double.total()).toBe(0);
  });

  it('configFrom writes abi.encode(nullifier, seed) from the prover proof, and the config vector bytes', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST)) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(config).toBe(configBytes(22n, 77n));

    expect(config).toBe(configRow.expected.encoded);
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

  it('configFrom with no stack is device-unavailable', async () => {
    const method = anonAadhaarMethod();

    expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'device-unavailable')).toBe(true);
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

  it('replyFrom with no stack is device-unavailable', async () => {
    const method = anonAadhaarMethod();
    const ctx = ctxFor(CONFIG, DIGEST);

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA }), 'device-unavailable')).toBe(true);
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
