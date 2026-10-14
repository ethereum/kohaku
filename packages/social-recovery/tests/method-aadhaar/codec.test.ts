import { describe, expect, it } from 'vitest';
import type { Fields, Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import {
  configBytes,
  configFile,
  configRow,
  proofBytes,
  proofFile,
  proofRow,
  stackDouble,
} from './fixtures';

const { codec } = anonAadhaarMethod({ stack: stackDouble().stack });

const big = (values: readonly string[]): bigint[] => values.map((value) => BigInt(value));

describe('the blessed rows', () => {
  it('reads the two vector files with the formats and derivations they state', () => {
    expect(configFile.format).toBe('method-aadhaar-config-v1');
    expect(configFile.derivation).toBe('abi.encode(uint256 nullifier, uint256 nullifierSeed)');
    expect(proofFile.format).toBe('method-aadhaar-proof-v1');
    expect(proofFile.derivation).toBe('abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[9] inputs)');
  });

  it('config row: encode, decode and re-encode byte for byte', () => {
    const fields = { nullifier: BigInt(configRow.input.nullifier), nullifierSeed: BigInt(configRow.input.nullifierSeed) };
    const encoded = codec.encodeConfig(fields);

    expect(encoded).toBe(configRow.expected.encoded);
    expect(configBytes(fields.nullifier, fields.nullifierSeed)).toBe(configRow.expected.encoded);
    expect((encoded.length - 2) / 2).toBe(64);

    const decoded = codec.decodeConfig(configRow.expected.encoded);

    expect(decoded['nullifier']).toBe(22n);
    expect(decoded['nullifierSeed']).toBe(77n);
    expect(codec.encodeConfig(decoded)).toBe(configRow.expected.encoded);
  });

  it('proof row: encode, decode and re-encode byte for byte, 544 bytes', () => {
    const { expected, input } = proofRow;
    const fields: Fields = {
      a: big(expected.a),
      b: expected.b.map((pair) => big(pair)),
      c: big(expected.c),
      inputs: big(input.inputs),
    };
    const encoded = codec.encodeProof(fields);

    expect(encoded).toBe(expected.encoded);
    expect((encoded.length - 2) / 2).toBe(expected.byteLength);
    expect(expected.byteLength).toBe(544);

    const decoded = codec.decodeProof(expected.encoded);

    expect(decoded['a']).toEqual([1n, 2n]);
    expect(decoded['b']).toEqual([
      [4n, 3n],
      [6n, 5n],
    ]);
    expect(decoded['c']).toEqual([7n, 8n]);
    expect(decoded['inputs']).toEqual(big(input.inputs));
    expect(codec.encodeProof(decoded)).toBe(expected.encoded);
  });

  it('the b swap: each encoded b pair is the upstream pi_b pair reversed, the verifier order', () => {
    const { upstreamProof } = proofRow.input;
    const decoded = codec.decodeProof(proofRow.expected.encoded);
    const b = decoded['b'] as readonly (readonly bigint[])[];

    expect(b[0]).toEqual([BigInt(upstreamProof.pi_b[0][1]), BigInt(upstreamProof.pi_b[0][0])]);
    expect(b[1]).toEqual([BigInt(upstreamProof.pi_b[1][1]), BigInt(upstreamProof.pi_b[1][0])]);
    expect(b[0]).not.toEqual(big(upstreamProof.pi_b[0]));
    // Words 2..5 of the encoding, as upstream packGroth16Proof orders them.
    const words = Array.from({ length: 17 }, (_, index) => BigInt(`0x${proofRow.expected.encoded.slice(2 + 64 * index, 66 + 64 * index)}`));

    expect(words.slice(0, 8)).toEqual([1n, 2n, 4n, 3n, 6n, 5n, 7n, 8n]);
  });

  it('proof row: the nine inputs sit after the eight Groth16 words in the verifier order', () => {
    const decoded = codec.decodeProof(proofRow.expected.encoded);
    const inputs = decoded['inputs'] as readonly bigint[];

    // 0 pubkeyHash, 1 nullifier, 2 timestamp, 3-6 disclosures, 7 nullifierSeed, 8 signalHash.
    expect(inputs).toHaveLength(9);
    expect(inputs[1]).toBe(22n);
    expect(inputs[7]).toBe(77n);
    expect(inputs[8]).toBe(BigInt(proofRow.expected.signalHash));
  });
});

const word = (value: bigint): string => value.toString(16).padStart(64, '0');
const config64: Hex = configBytes(22n, 77n);
const proof544: Hex = proofBytes({
  a: [1n, 2n],
  b: [
    [4n, 3n],
    [6n, 5n],
  ],
  c: [7n, 8n],
  inputs: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n],
});

describe('config refusals', () => {
  it.each([
    ['32 bytes, a bare bytes32', `0x${word(22n)}`],
    ['63 bytes', config64.slice(0, -2)],
    ['65 bytes', `${config64}00`],
    ['96 bytes', `${config64}${word(1n)}`],
    ['empty', '0x'],
    ['odd digits', `${config64}0`],
    ['non-hex', `0x${'zz'.repeat(64)}`],
    ['no prefix', config64.slice(2)],
  ])('decodeConfig refuses %s', (_label, bytes) => {
    expect(() => codec.decodeConfig(bytes as Hex)).toThrow();
  });

  it.each([
    ['a missing seed', { nullifier: 22n }],
    ['a negative nullifier', { nullifier: -1n, nullifierSeed: 77n }],
    ['a seed of 2^256', { nullifier: 22n, nullifierSeed: 1n << 256n }],
    ['a number rather than a bigint', { nullifier: 22, nullifierSeed: 77n }],
  ])('encodeConfig refuses %s', (_label, fields) => {
    expect(() => codec.encodeConfig(fields as Fields)).toThrow();
  });

  it('accepts the largest uint256 in both words and round-trips it', () => {
    const max = (1n << 256n) - 1n;
    const bytes = codec.encodeConfig({ nullifier: max, nullifierSeed: max });

    expect(bytes).toBe(configBytes(max, max));
    expect(codec.decodeConfig(bytes)).toEqual({ nullifier: max, nullifierSeed: max });
  });
});

describe('proof refusals', () => {
  it.each([
    ['543 bytes', proof544.slice(0, -2)],
    ['545 bytes', `${proof544}00`],
    ['576 bytes, a tenth input', `${proof544}${word(10n)}`],
    ['512 bytes, eight inputs', proof544.slice(0, -64)],
    ['the 64-byte config', config64],
    ['empty', '0x'],
  ])('decodeProof refuses %s', (_label, bytes) => {
    expect(() => codec.decodeProof(bytes as Hex)).toThrow();
  });

  const good = { a: [1n, 2n], b: [[4n, 3n], [6n, 5n]], c: [7n, 8n], inputs: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n] };

  it.each([
    ['eight inputs', { ...good, inputs: good.inputs.slice(0, 8) }],
    ['ten inputs', { ...good, inputs: [...good.inputs, 10n] }],
    ['a of three words', { ...good, a: [1n, 2n, 1n] }],
    ['b of three pairs', { ...good, b: [...good.b, [1n, 0n]] }],
    ['a b pair of three words', { ...good, b: [[4n, 3n, 0n], [6n, 5n]] }],
    ['c of one word', { ...good, c: [7n] }],
    ['an input of 2^256', { ...good, inputs: [...good.inputs.slice(0, 8), 1n << 256n] }],
    ['decimal strings', { ...good, inputs: good.inputs.map(String) }],
  ])('encodeProof refuses %s', (_label, fields) => {
    expect(() => codec.encodeProof(fields as unknown as Fields)).toThrow();
  });

  it('encodes a well-formed proof exactly as abi.encode(a, b, c, inputs[9]) does', () => {
    expect(codec.encodeProof(good)).toBe(proof544);
    expect((proof544.length - 2) / 2).toBe(544);
  });
});
