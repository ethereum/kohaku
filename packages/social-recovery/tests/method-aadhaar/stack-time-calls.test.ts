import { afterEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_STACK_TIME_CALLS } from '../../src/constants/method-aadhaar';
import { configBytes, ctxFor, nine, proofBytes, signalsFor } from './fixtures';

const PRODUCTION_KEY = '18063425702624337643644061197836918910810808173893535653269228433734128853484';
const TEST_KEY = '15134874015316324267425466444584014077184337590635665158241104437045239495873';
const DIGEST = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339' as const;
const ARTIFACTS = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;

/** A peer surface that carries every member the default stack checks, but `without`. */
function surface(without?: string) {
  const members: { [name: string]: unknown } = {
    init: vi.fn(() => Promise.resolve()),
    generateArgs: vi.fn(() => Promise.resolve({})),
    prove: vi.fn(() => Promise.resolve({})),
    verify: vi.fn(() => Promise.resolve(true)),
    timestampToUTCUnix: vi.fn(() => 0),
    decompressByteArray: vi.fn(() => new Uint8Array()),
    convertBigIntToByteArray: vi.fn(() => new Uint8Array()),
    ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
    productionPublicKeyHash: PRODUCTION_KEY,
    testPublicKeyHash: TEST_KEY,
  };

  if (without !== undefined) delete members[without];

  return members;
}

/** The method module freshly loaded over the given peer surface. */
async function loadOver(members: { [name: string]: unknown }) {
  vi.resetModules();
  vi.doMock('@anon-aadhaar/core', () => members);

  return await import('../../src/method-aadhaar');
}

const proof = proofBytes({
  a: [1n, 2n],
  b: [
    [4n, 3n],
    [6n, 5n],
  ],
  c: [7n, 8n],
  inputs: nine(signalsFor(22n, 77n, DIGEST, { pubkeyHash: BigInt(PRODUCTION_KEY) })),
});

afterEach(() => {
  vi.doUnmock('@anon-aadhaar/core');
});

describe('the default stack loads a peer surface missing a time call, its signedAt answering undefined', () => {
  it('the full surface loads: a production-key proof is satisfied', async () => {
    const members = surface();
    const { anonAadhaarMethod } = await loadOver(members);

    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctxFor(configBytes(22n, 77n), DIGEST), proof)).toBe('satisfied');
    expect(members['init']).toHaveBeenCalledTimes(1);
  });

  it.each(METHOD_AADHAAR_STACK_TIME_CALLS)('without %s the stack still loads: a production-key proof is satisfied', async (missing) => {
    const members = surface(missing);
    const { anonAadhaarMethod } = await loadOver(members);

    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctxFor(configBytes(22n, 77n), DIGEST), proof)).toBe('satisfied');
    expect(members['init']).toHaveBeenCalledTimes(1);
    expect(members['verify']).toHaveBeenCalledTimes(1);
  });

  it.each(METHOD_AADHAAR_STACK_TIME_CALLS)('without %s the stack\'s signedAt answers undefined', async (missing) => {
    vi.resetModules();
    vi.doMock('@anon-aadhaar/core', () => surface(missing));

    const { coreStack } = await import('../../src/method-aadhaar/stack');

    await expect(coreStack(ARTIFACTS).signedAt?.('1234')).resolves.toBeUndefined();
  });
});
