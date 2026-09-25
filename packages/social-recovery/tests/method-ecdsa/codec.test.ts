import { getAddress, isAddressEqual } from 'viem';
import { describe, expect, it } from 'vitest';
import { walletMethod, type Hex } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { addressWord, ctxFor, expectedOf, KEY_ONE, rowName, signDigest, SIGNER_ONE, SIGNER_TWO } from './fixtures';

const codec = walletMethod().codec;

const SIGNATURE_65: Hex = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;

describe('config: one ABI-encoded address', () => {
  it('encodes the signer as twelve zero bytes then its twenty bytes, 32 bytes in all', () => {
    const encoded = codec.encodeConfig({ signer: SIGNER_TWO });

    expect(encoded.toLowerCase()).toBe(addressWord(SIGNER_TWO));
    expect((encoded.length - 2) / 2).toBe(32);
  });

  it('decodes the word back to the same address', () => {
    const decoded = codec.decodeConfig(addressWord(SIGNER_TWO));
    const signer = decoded['signer'];

    expect(typeof signer).toBe('string');
    expect(isAddressEqual(signer as Hex, SIGNER_TWO)).toBe(true);
  });

  it('round trips encode -> decode -> encode for checksummed and lower-case input', () => {
    for (const address of [SIGNER_ONE, SIGNER_TWO.toLowerCase() as Hex, getAddress('0x00000000000000000000000000000000000000a1')]) {
      const word = codec.encodeConfig({ signer: address });

      expect(codec.encodeConfig(codec.decodeConfig(word)).toLowerCase()).toBe(word.toLowerCase());
    }
  });

  it('decodes an upper-case-hex word to the same address (hex case is not bytes)', () => {
    const upper = `0x${addressWord(SIGNER_ONE).slice(2).toUpperCase()}` as Hex;

    expect(isAddressEqual(codec.decodeConfig(upper)['signer'] as Hex, SIGNER_ONE)).toBe(true);
  });

  const word = addressWord(SIGNER_ONE);
  const refused: readonly (readonly [string, Hex])[] = [
    ['empty', '0x'],
    ['the bare 20-byte address, not ABI-encoded', SIGNER_ONE],
    ['31 bytes', `0x${word.slice(4)}`],
    ['33 bytes, a trailing byte', `${word}00`],
    ['64 bytes, two words', `${word}${word.slice(2)}`],
    ['dirty padding in the top twelve bytes', `0x01${word.slice(4)}`],
    ['odd-length hex', `${word}0`],
    ['not hex at all', `0x${'zz'.repeat(32)}`],
    ['no 0x prefix', word.slice(2) as Hex],
  ];

  it.each(refused)('decodeConfig refuses %s', (_label, bytes) => {
    expect(() => codec.decodeConfig(bytes)).toThrow();
  });

  it('encodeConfig refuses a malformed signer', () => {
    expect(() => codec.encodeConfig({ signer: '0x1234' })).toThrow();
    expect(() => codec.encodeConfig({ signer: 42 })).toThrow();
    expect(() => codec.encodeConfig({})).toThrow();
  });
});

describe('proof: the signature bytes as returned', () => {
  it('encodes a 65-byte signature to exactly its bytes, not abi.encode(bytes)', () => {
    expect(codec.encodeProof({ signature: SIGNATURE_65 }).toLowerCase()).toBe(SIGNATURE_65);
  });

  it('decodes proof bytes to the same signature', () => {
    expect(String(codec.decodeProof(SIGNATURE_65)['signature']).toLowerCase()).toBe(SIGNATURE_65);
  });

  it.each([
    ['65 bytes', SIGNATURE_65],
    ['empty (the vector\'s own row)', '0x' as Hex],
    ['2 bytes an ERC-1271 wallet might check', '0xbeef' as Hex],
    ['64 bytes, a compact form passed as returned', `0x${'33'.repeat(64)}` as Hex],
    ['200 bytes of ERC-1271 data', `0x${'44'.repeat(200)}` as Hex],
  ])('round trips %s unchanged', (_label, bytes) => {
    const decoded = codec.decodeProof(bytes);

    expect(codec.encodeProof(decoded).toLowerCase()).toBe(bytes.toLowerCase());
  });

  it.each([
    ['odd-length hex', '0x123' as Hex],
    ['non-hex characters', '0xzz' as Hex],
    ['no 0x prefix', 'abcd' as Hex],
  ])('decodeProof refuses %s', (_label, bytes) => {
    expect(() => codec.decodeProof(bytes)).toThrow();
  });

  it('encodeProof refuses a non-hex signature', () => {
    expect(() => codec.encodeProof({ signature: '0x123' })).toThrow();
    expect(() => codec.encodeProof({ signature: 7 })).toThrow();
  });
});

describe('method-ecdsa-config.json replay', () => {
  const rows = readVector('method-ecdsa-config.json').vectors;

  it('has the expected rows', () => {
    expect(rows.map(rowName)).toEqual(['test-signer', 'zero-address']);
  });

  it.each(rows.map((row) => [rowName(row), row] as const))('row %s: encode reproduces expected.encoded and decode gives the signer back', (_rowId, row) => {
    const signer = row.input['signer'] as Hex;
    const encoded = expectedOf(row)['encoded'] as Hex;

    expect(codec.encodeConfig({ signer })).toBe(encoded);
    expect(isAddressEqual(codec.decodeConfig(encoded)['signer'] as Hex, signer)).toBe(true);
  });

  it('row zero-address: the zero signer is never satisfied ("cannot recover zero signer")', async () => {
    const row = rows.find((candidate) => rowName(candidate) === 'zero-address');
    const ctx = ctxFor({ config: expectedOf(row)['encoded'] as Hex, credentialHoldsCode: false });
    const proof = await signDigest(ctx.digest);

    expect(await walletMethod().verify(ctx, proof)).toBe('rejected');
  });
});

describe('method-ecdsa-proof.json replay', () => {
  const rows = readVector('method-ecdsa-proof.json').vectors;

  it('has the expected rows', () => {
    expect(rows.map(rowName)).toEqual(['deterministic-test-key', 'empty']);
  });

  it.each(rows.map((row) => [rowName(row), row] as const))('row %s: the codec reproduces expected.proof byte for byte', (_rowId, row) => {
    const proof = expectedOf(row)['proof'] as Hex;

    expect(codec.encodeProof({ signature: proof })).toBe(proof);
    expect(codec.encodeProof(codec.decodeProof(proof))).toBe(proof);
  });

  it.each(rows.map((row) => [rowName(row), row] as const))('row %s: the verdict matches eoaVerification', async (_rowId, row) => {
    const signer = row.input['signer'] as Hex;
    const base = ctxFor({ guardian: signer, credentialHoldsCode: false });
    const ctx = { ...base, digest: row.input['digest'] as Hex };
    const verdict = await walletMethod().verify(ctx, expectedOf(row)['proof'] as Hex);

    expect(verdict).toBe(expectedOf(row)['eoaVerification'] === true ? 'satisfied' : 'rejected');
  });

  it('row deterministic-test-key: key 0x01 signing the digest with viem reproduces the proof', async () => {
    const row = rows.find((candidate) => rowName(candidate) === 'deterministic-test-key');

    expect(isAddressEqual(row?.input['signer'] as Hex, SIGNER_ONE)).toBe(true);
    expect(await signDigest(row?.input['digest'] as Hex, KEY_ONE)).toBe(expectedOf(row)['proof']);
  });

  it('row deterministic-test-key: replyFrom returns the proof unchanged, already low-s with v = 27', async () => {
    const row = rows.find((candidate) => rowName(candidate) === 'deterministic-test-key');
    const reply = await walletMethod().replyFrom(ctxFor(), {}, { signature: expectedOf(row)['proof'] });

    expect(reply).toBe(expectedOf(row)['proof']);
  });
});
