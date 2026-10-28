import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { configBytes, proofBytes, type ProofWords } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const { codec } = anonAadhaarMethod();

const wordArb = fc.oneof(
  fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }),
  fc.constantFrom(0n, 1n, (1n << 255n), (1n << 256n) - 1n),
);

const pairArb = fc.tuple(wordArb, wordArb);

const proofArb: fc.Arbitrary<ProofWords> = fc.record({
  a: pairArb,
  b: fc.tuple(pairArb, pairArb),
  c: pairArb,
  inputs: fc.tuple(wordArb, wordArb, wordArb, wordArb, wordArb, wordArb, wordArb, wordArb, wordArb),
});

/** The hex digits upper-cased behind a lower-case prefix, when `upper` asks for it. */
const spelled = (bytes: Hex, upper: boolean): Hex => (upper ? `0x${bytes.slice(2).toUpperCase()}` : bytes);

describe('method-aadhaar codec properties', () => {
  it('config: any three words encode to abi.encode(nullifier, seed, window), decode back and re-encode to the same bytes', () => {
    fc.assert(
      fc.property(wordArb, wordArb, wordArb, (nullifier, nullifierSeed, freshnessWindow) => {
        const encoded = codec.encodeConfig({ nullifier, nullifierSeed, freshnessWindow });

        expect(encoded).toBe(configBytes(nullifier, nullifierSeed, freshnessWindow));
        expect((encoded.length - 2) / 2).toBe(96);
        expect(codec.decodeConfig(encoded)).toEqual({ nullifier, nullifierSeed, freshnessWindow });
        expect(codec.encodeConfig(codec.decodeConfig(encoded))).toBe(encoded);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('config: any 96 bytes, in either hex case, decode and re-encode to the same bytes lower-cased', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 96, maxLength: 96 }), fc.boolean(), (raw, upper) => {
        const bytes = bytesToHex(raw);

        expect(codec.encodeConfig(codec.decodeConfig(spelled(bytes, upper)))).toBe(bytes);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('proof: any words encode to abi.encode(a, b, c, inputs), 544 bytes, decode back and re-encode to the same bytes', () => {
    fc.assert(
      fc.property(proofArb, (words) => {
        const encoded = codec.encodeProof({ a: [...words.a], b: words.b.map((pair) => [...pair]), c: [...words.c], inputs: [...words.inputs] });
        const decoded = codec.decodeProof(encoded);

        expect(encoded).toBe(proofBytes(words));
        expect((encoded.length - 2) / 2).toBe(544);
        expect(decoded['a']).toEqual([...words.a]);
        expect(decoded['b']).toEqual(words.b.map((pair) => [...pair]));
        expect(decoded['c']).toEqual([...words.c]);
        expect(decoded['inputs']).toEqual([...words.inputs]);
        expect(codec.encodeProof(decoded)).toBe(encoded);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('proof: any 544 bytes, in either hex case, decode and re-encode to the same bytes lower-cased', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 544, maxLength: 544 }), fc.boolean(), (raw, upper) => {
        const bytes = bytesToHex(raw);

        expect(codec.encodeProof(codec.decodeProof(spelled(bytes, upper)))).toBe(bytes);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });

  it('a config and a proof never pass for each other: any length but the right one is refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), (length) => {
        const bytes = bytesToHex(new Uint8Array(length));

        if (length !== 96) expect(() => codec.decodeConfig(bytes)).toThrow();

        if (length !== 544) expect(() => codec.decodeProof(bytes)).toThrow();
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  });
});
