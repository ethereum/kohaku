import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_SIGNED_AT_SLACK, METHOD_AADHAAR_STACK_TIME_CALLS } from '../../src/constants/method-aadhaar';
import { METHOD_AADHAAR_DEFAULT_ARTIFACTS } from '../../src/constants/method-aadhaar-bucket';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { coreStack } from '../../src/method-aadhaar/stack';
import { CERTIFICATE, clockAt, configBytes, ctxFor, FRESHNESS_WINDOW, isFailure, pcdOf, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';

type PeerHelpers = {
  readonly rawDataToCompressedQR: (data: Uint8Array) => bigint;
  readonly timestampToUTCUnix: (raw: Uint8Array) => number;
  readonly decompressByteArray: (bytes: Uint8Array) => Uint8Array;
  readonly convertBigIntToByteArray: (value: bigint) => Uint8Array;
};

const spies = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.resolve()),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn((): Promise<boolean> => Promise.resolve(true)),
}));

/** The installed peer with its real QR helpers, its calls that need artifacts replaced by spies. */
vi.mock('@anon-aadhaar/core', async (importActual) => ({ ...(await importActual<object>()), ...spies }));

const peer = (await vi.importActual('@anon-aadhaar/core')) as PeerHelpers;

const ARTIFACTS = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;

const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/**
 * A secure-QR V2 payload built here: `V2`, the e-mail/mobile indicator, then the reference id, whose bytes 9..18
 * are the signing time `YYYYMMDDHH` in IST, here 2024-05-13 16h; the signature is filler, the time read never checks it.
 */
const RAW = new Uint8Array([
  ...ascii('V2'), 255, ...ascii('3'), 255, ...ascii('1234'), ...ascii('2024051316'), ...ascii('3000123'), 255,
  ...ascii('Sumit Kumar'), 255, ...ascii('01-01-1984'), 255, ...ascii('M'), 255,
  ...Array.from({ length: 256 }, (_, index) => index),
]);

/** The fixture compressed and spelled as a decimal string with the peer's own exported helper, as a QR reader hands it. */
const QR = peer.rawDataToCompressedQR(RAW).toString();

/** 2024-05-13 16:00 IST is 10:30 UTC. */
const QR_SIGNED_AT = BigInt(Date.UTC(2024, 4, 13, 10, 30) / 1000);

const DIGEST = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339' as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the default stack reads the QR signing time with the peer\'s helpers', () => {
  it('the installed peer exports the three time calls as functions', async () => {
    const installed = (await vi.importActual('@anon-aadhaar/core')) as { readonly [name: string]: unknown };

    for (const name of METHOD_AADHAAR_STACK_TIME_CALLS) expect(typeof installed[name], name).toBe('function');
  });

  it('the fixture decodes back to its YYYYMMDDHH bytes through the peer\'s own decoding', () => {
    const raw = peer.decompressByteArray(peer.convertBigIntToByteArray(BigInt(QR)));

    expect(new TextDecoder().decode(raw.slice(9, 19))).toBe('2024051316');
    expect(peer.timestampToUTCUnix(raw)).toBe(Number(QR_SIGNED_AT));
  });

  it('signedAt answers the fixture\'s signing time in Unix seconds without calling init', async () => {
    const stack = coreStack(ARTIFACTS);

    expect(await stack.signedAt?.(QR)).toBe(QR_SIGNED_AT);
    expect(spies.init).not.toHaveBeenCalled();
    expect(spies.generateArgs).not.toHaveBeenCalled();
  });

  it('signedAt imports the peer under the default bucket too, without its init', async () => {
    expect(await coreStack(METHOD_AADHAAR_DEFAULT_ARTIFACTS).signedAt?.(QR)).toBe(QR_SIGNED_AT);
    expect(spies.init).not.toHaveBeenCalled();
  });

  it.each([
    ['not a number', 'not a number'],
    ['a number that is no deflate stream', '123456789012345678901234567890'],
    ['empty', ''],
  ])('signedAt answers undefined for a QR string %s, never a throw', async (_case, qrData) => {
    await expect(coreStack(ARTIFACTS).signedAt?.(qrData)).resolves.toBeUndefined();
    expect(spies.init).not.toHaveBeenCalled();
  });
});

describe('the default stack\'s read reaches replyFrom', () => {
  const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
  const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };

  it('a QR older than the window and the slack is material-rejected before init, generateArgs or prove', async () => {
    clockAt(QR_SIGNED_AT + FRESHNESS_WINDOW + METHOD_AADHAAR_SIGNED_AT_SLACK + 1n);

    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });

    expect(isFailure(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR }), 'material-rejected')).toBe(true);
    expect(spies.init).not.toHaveBeenCalled();
    expect(spies.generateArgs).not.toHaveBeenCalled();
    expect(spies.prove).not.toHaveBeenCalled();
  });

  it('a QR inside the window goes on to init and the prover', async () => {
    clockAt(QR_SIGNED_AT + 600n);
    spies.prove.mockResolvedValueOnce(pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { timestamp: QR_SIGNED_AT })));

    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR });

    expect(spies.init).toHaveBeenCalledTimes(1);
    expect(spies.generateArgs).toHaveBeenCalledTimes(1);
    expect(spies.prove).toHaveBeenCalledTimes(1);
    expect(typeof reply).toBe('string');
  });
});
