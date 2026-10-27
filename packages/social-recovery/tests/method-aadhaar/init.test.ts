import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE } from '../../src/constants/method-aadhaar';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { coreStack } from '../../src/method-aadhaar/stack';
import { CERTIFICATE, clockAt, configBytes, ctxFor, FRESH_NOW, isFailure, nine, pcdOf, proofBytes, QR_DATA, signalsFor, stackDouble, SYNTHETIC_UPSTREAM } from './fixtures';

const core = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.reject(new Error('fetch failed: https://unreachable.invalid/circuit.wasm'))),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn<(pcd: unknown, testMode?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
  timestampToUTCUnix: vi.fn((): number => 0),
  decompressByteArray: vi.fn((): Uint8Array => {
    throw new Error('incorrect header check');
  }),
  convertBigIntToByteArray: vi.fn((): Uint8Array => new Uint8Array([1])),
}));

/** The peer's two key hashes, `productionPublicKeyHash` and `testPublicKeyHash` of `@anon-aadhaar/core` 2.4.3. */
const PRODUCTION_KEY = '18063425702624337643644061197836918910810808173893535653269228433734128853484';
const TEST_KEY = '15134874015316324267425466444584014077184337590635665158241104437045239495873';

vi.mock('@anon-aadhaar/core', () => ({
  ...core,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
  productionPublicKeyHash: PRODUCTION_KEY,
  testPublicKeyHash: TEST_KEY,
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

afterEach(() => {
  vi.restoreAllMocks();
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

describe('the default stack passes the test-mode flag to the peer\'s verify', () => {
  const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
  const proofUnder = (pubkeyHash: bigint) =>
    proofBytes({
      a: [1n, 2n],
      b: [
        [4n, 3n],
        [6n, 5n],
      ],
      c: [7n, 8n],
      inputs: nine(signalsFor(22n, 77n, DIGEST, { pubkeyHash })),
    });
  const production = proofUnder(BigInt(PRODUCTION_KEY));
  const test = proofUnder(BigInt(TEST_KEY));
  const proof = proofUnder(99n);

  it.each([
    ['by default', { artifacts: ARTIFACTS }, false, production],
    ['under testMode: false', { artifacts: ARTIFACTS, testMode: false }, false, production],
    ['under testMode: true', { artifacts: ARTIFACTS, testMode: true }, true, test],
  ] as const)('%s the peer receives (pcd, %s) and its true answer is satisfied', async (_why, options, flag, bytes) => {
    core.init.mockResolvedValueOnce(undefined);

    expect(await anonAadhaarMethod(options).verify(ctx, bytes)).toBe('satisfied');
    expect(core.verify).toHaveBeenCalledTimes(1);
    expect(core.verify.mock.calls[0]).toEqual([expect.objectContaining({ proof: expect.objectContaining({ nullifier: '22' }) }), flag]);
  });

  it.each([
    ['a test-key proof under the default', { artifacts: ARTIFACTS }, test],
    ['a production-key proof under testMode: true', { artifacts: ARTIFACTS, testMode: true }, production],
    ['a proof under an unknown key under testMode: true', { artifacts: ARTIFACTS, testMode: true }, proof],
  ] as const)('%s is rejected once the peer is loaded, without calling its verify', async (_why, options, bytes) => {
    core.init.mockResolvedValueOnce(undefined);

    expect(await anonAadhaarMethod(options).verify(ctx, bytes)).toBe('rejected');
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['by default', { artifacts: ARTIFACTS }],
    ['under testMode: false', { artifacts: ARTIFACTS, testMode: false }],
  ] as const)('a proof under an unknown key %s reaches the peer, whose key-mismatch throw is not-judged', async (_why, options) => {
    core.init.mockResolvedValueOnce(undefined);
    core.verify.mockRejectedValueOnce(new Error('VerificationError: public key mismatch.'));

    expect(await anonAadhaarMethod(options).verify(ctx, proof)).toBe('not-judged');
    expect(core.verify).toHaveBeenCalledTimes(1);
    expect(core.verify.mock.calls[0]).toEqual([expect.objectContaining({ proof: expect.objectContaining({ pubkeyHash: '99' }) }), false]);
  });

  it('a production-key proof under the default reaches the peer and its true answer is satisfied', async () => {
    core.init.mockResolvedValueOnce(undefined);

    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctx, production)).toBe('satisfied');
    expect(core.verify).toHaveBeenCalledTimes(1);
    expect(core.verify.mock.calls[0]).toEqual([expect.objectContaining({ proof: expect.objectContaining({ pubkeyHash: PRODUCTION_KEY }) }), false]);
  });

  it('an unknown-key proof under the default makes replyFrom hand the proof on, the prover run once', async () => {
    clockAt(FRESH_NOW);
    core.init.mockResolvedValueOnce(undefined);
    core.generateArgs.mockResolvedValueOnce({});
    core.prove.mockResolvedValueOnce(pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { pubkeyHash: 99n })));
    core.verify.mockRejectedValueOnce(new Error('VerificationError: public key mismatch.'));

    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(typeof reply).toBe('string');
    expect(((reply as string).length - 2) / 2).toBe(544);
    expect(core.generateArgs).toHaveBeenCalledTimes(1);
    expect(core.prove).toHaveBeenCalledTimes(1);
    expect(core.verify).toHaveBeenCalledTimes(1);
    expect(core.verify.mock.calls[0]?.[1]).toBe(false);
  });

  it.each([false, true])('an unparsable pubkeyHash answers false without calling the peer, testMode %s', async (testMode) => {
    core.init.mockResolvedValueOnce(undefined);

    const pcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));

    expect(await coreStack(ARTIFACTS).verify({ proof: { ...pcd.proof, pubkeyHash: 'not a number' } }, testMode)).toBe(false);
    expect(core.verify).not.toHaveBeenCalled();
  });

  it('a wrong-key proof under a stack that cannot load is still not-judged', async () => {
    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctx, test)).toBe('not-judged');
    expect(core.verify).not.toHaveBeenCalled();
  });

  it('a wrong-key proof makes replyFrom material-rejected, not a reply', async () => {
    core.init.mockResolvedValueOnce(undefined);
    core.generateArgs.mockResolvedValueOnce({});
    core.prove.mockResolvedValueOnce(pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { pubkeyHash: BigInt(TEST_KEY) })));

    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'material-rejected')).toBe(true);
    expect(core.verify).not.toHaveBeenCalled();
  });

  it('a peer that throws for another reason is still not-judged, in either mode', async () => {
    core.init.mockResolvedValue(undefined);
    core.verify.mockRejectedValue(new Error('vkey.json: fetch failed'));

    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS, testMode: true }).verify(ctx, test)).toBe('not-judged');
    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctx, production)).toBe('not-judged');
    expect(core.verify).toHaveBeenCalledTimes(2);
  });

  it('{ stack, testMode } is allowed and never imports the peer; { stack, artifacts } is refused as before', async () => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack, testMode: true }).verify(ctx, proof)).toBe('satisfied');
    expect(double.verifyFlags).toEqual([true]);
    expect(core.init).not.toHaveBeenCalled();
    expect(core.verify).not.toHaveBeenCalled();
    expect(() => anonAadhaarMethod({ stack: double.stack, artifacts: ARTIFACTS })).toThrow(new TypeError(METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE));
  });
});
