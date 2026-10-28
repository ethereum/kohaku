import { hexToBytes, keccak256 } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../../src/constants';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { keccak256 as ownKeccak } from '../helpers/keccak';
import {
  CERTIFICATE,
  clockForFile,
  configBytes,
  ctxFor,
  FRESH_NOW,
  isFailure,
  lastWord,
  nine,
  pcdOf,
  proofBytes,
  QR_DATA,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
} from './fixtures';

const DIGESTS: readonly (readonly [string, Hex])[] = [
  ['zero', `0x${'00'.repeat(32)}`],
  ['one', `0x${'00'.repeat(31)}01`],
  ['0xff00…00, top byte set', `0xff${'00'.repeat(31)}`],
  ['0xff…ff, every bit set', `0x${'ff'.repeat(32)}`],
  ['0x80…00, only the top bit', `0x80${'00'.repeat(31)}`],
  ['the proof vector digest', '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339'],
];

const SEED = 5n;
const NULLIFIER = 6n;
const CONFIG = configBytes(NULLIFIER, SEED);

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

/** The signal hash by hand: the keccak256 hash read big-endian, less its three low bits. */
function reduce(digest: Hex): bigint {
  const hash = hexToBytes(keccak256(digest));
  let value = 0n;

  for (const byte of hash) value = (value << 8n) | BigInt(byte);

  return value / 8n;
}

describe.each(DIGESTS)('the signal hash for %s', (_label, digest) => {
  const expected = reduce(digest);

  it('agrees between viem, the suite keccak and the shift, and fits under 2^253', () => {
    expect(BigInt(keccak256(digest)) >> 3n).toBe(expected);
    expect(BigInt(ownKeccak(hexToBytes(digest))) >> 3n).toBe(expected);
    expect(expected < 1n << 253n).toBe(true);
  });

  it('replyFrom hands the digest to the prover as one 256-bit number and emits the reduction as the last word', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(NULLIFIER, SEED, digest)) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(CONFIG, digest);
    const input = method.signingInput(ctx, { nullifierSeed: SEED, issuerCertificate: CERTIFICATE });
    const proof = await method.replyFrom(ctx, input, { qrData: QR_DATA });

    expect(typeof proof).toBe('string');
    expect(lastWord(proof as Hex)).toBe(expected);
    expect((proof as Hex).slice(-64)).toBe(expected.toString(16).padStart(64, '0'));

    const signal = double.generateArgsCalls[0]?.signal;

    expect(signal).toBeDefined();
    expect(BigInt(signal ?? '-1')).toBe(BigInt(digest));
  });

  it.each([
    ['the reduction plus one', expected + 1n],
    ['the unshifted keccak', BigInt(keccak256(digest))],
    ['the digest itself', BigInt(digest)],
    ['a shift by four', BigInt(keccak256(digest)) >> 4n],
  ])('replyFrom refuses a prover whose signal hash is %s', async (_wrong, signalHash) => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(NULLIFIER, SEED, digest, { signalHash })) });
    const method = anonAadhaarMethod({ stack: double.stack });
    const ctx = ctxFor(CONFIG, digest);
    const input = method.signingInput(ctx, { nullifierSeed: SEED, issuerCertificate: CERTIFICATE });

    expect(isFailure(await method.replyFrom(ctx, input, { qrData: QR_DATA }), 'material-rejected')).toBe(true);
  });

  it('verify under the default bucket binds the reduction and nothing near it', async () => {
    const method = anonAadhaarMethod();
    const ctx = ctxFor(CONFIG, digest);
    const proofWith = (signalHash: bigint): Hex =>
      proofBytes({
        a: [1n, 2n],
        b: [
          [4n, 3n],
          [6n, 5n],
        ],
        c: [7n, 8n],
        inputs: nine(signalsFor(NULLIFIER, SEED, digest, { signalHash })),
      });

    expect(await method.verify(ctx, proofWith(expected))).toBe('satisfied');
    expect(await method.verify(ctx, proofWith(expected ^ 1n))).toBe('rejected');
    expect(await method.verify(ctx, proofWith(BigInt(keccak256(digest))))).toBe('rejected');
    expect(core.init.mock.calls).toEqual([[CHUNKED_INIT]]);
    expect(core.verify).toHaveBeenCalledTimes(1);
  });
});

describe('pinned values', () => {
  it('the proof vector digest reduces to the blessed signal hash', () => {
    expect(reduce('0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339')).toBe(
      12653108475559566292666453612627920725041672340404626263243289921828173745363n,
    );
  });
});
