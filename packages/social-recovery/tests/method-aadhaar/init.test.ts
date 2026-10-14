import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { CERTIFICATE, configBytes, ctxFor, isFailure, QR_DATA } from './fixtures';

const core = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.reject(new Error('fetch failed: https://unreachable.invalid/circuit.wasm'))),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn((): Promise<boolean> => Promise.resolve(true)),
}));

vi.mock('@anon-aadhaar/core', () => ({
  ...core,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
}));

/** The proof vector's digest. */
const DIGEST = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ARTIFACTS = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a stack whose init rejects', () => {
  it('configFrom is device-unavailable and the prover is never called', async () => {
    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(isFailure(config, 'device-unavailable')).toBe(true);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });

  it('replyFrom is device-unavailable and the prover is never called', async () => {
    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'device-unavailable')).toBe(true);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });
});
