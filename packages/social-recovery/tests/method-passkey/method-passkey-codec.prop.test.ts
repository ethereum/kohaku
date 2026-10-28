import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { configBytes, HALF_N, hexOf, proofBytes } from './fixtures';
import { parameters, PROPERTY_TIMEOUT } from './property';

const { codec } = passkeyMethod();

const UINT256_LIMIT = 1n << 256n;

const uint256 = fc.bigInt({ min: 0n, max: UINT256_LIMIT - 1n });
const word = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => hexOf(bytes));

const configArb = fc.record({ x: uint256, y: uint256, rpIdHash: word });

const proofArb = fc.record({
  authenticatorData: fc.uint8Array({ minLength: 0, maxLength: 160 }).map((bytes) => hexOf(bytes)),
  clientDataJSON: fc.string({ unit: 'grapheme', maxLength: 200 }),
  r: uint256,
  s: fc.bigInt({ min: 0n, max: HALF_N }),
});

/** Upper-cases the hex digits, keeping the 0x prefix. */
const upper = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;

describe('method-passkey properties: the codec', () => {
  it(
    'config: encode writes abi.encode(x, y, rpIdHash) in lower case, and decode then encode reproduces it',
    () => {
      fc.assert(
        fc.property(configArb, (config) => {
          const encoded = codec.encodeConfig(config);

          expect(encoded).toBe(configBytes(config.x, config.y, config.rpIdHash));
          expect(codec.decodeConfig(encoded)).toEqual(config);
          expect(codec.encodeConfig(codec.decodeConfig(encoded))).toBe(encoded);
          expect(codec.encodeConfig({ ...config, rpIdHash: upper(config.rpIdHash) })).toBe(encoded);
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );

  it(
    'proof: encode writes abi.encode(authenticatorData, clientDataJSON, r, s) in lower case, and decode then encode reproduces it',
    () => {
      fc.assert(
        fc.property(proofArb, (proof) => {
          const encoded = codec.encodeProof(proof);

          expect(encoded).toBe(proofBytes(proof.authenticatorData, proof.clientDataJSON, proof.r, proof.s));
          expect(codec.decodeProof(encoded)).toEqual(proof);
          expect(codec.encodeProof(codec.decodeProof(encoded))).toBe(encoded);
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );

  it(
    'a value past its width is a RangeError: x, y, r or s at 2^256 or above, or below zero, and s above n/2',
    () => {
      const beyond = fc.oneof(fc.bigInt({ min: UINT256_LIMIT, max: UINT256_LIMIT << 8n }), fc.bigInt({ min: -(1n << 64n), max: -1n }));

      fc.assert(
        fc.property(configArb, proofArb, beyond, fc.bigInt({ min: HALF_N + 1n, max: UINT256_LIMIT - 1n }), (config, proof, bad, highS) => {
          expect(() => codec.encodeConfig({ ...config, x: bad })).toThrow(RangeError);
          expect(() => codec.encodeConfig({ ...config, y: bad })).toThrow(RangeError);
          expect(() => codec.encodeProof({ ...proof, r: bad })).toThrow(RangeError);
          expect(() => codec.encodeProof({ ...proof, s: bad })).toThrow(RangeError);
          expect(() => codec.encodeProof({ ...proof, s: highS })).toThrow(RangeError);
          expect(() => codec.decodeProof(proofBytes(proof.authenticatorData, proof.clientDataJSON, proof.r, highS))).toThrow(RangeError);
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});
