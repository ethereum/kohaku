import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodePaymentOrder, decodeProofPlace, encodePaymentOrder, encodeProofPlace } from '../../src/index';
import { run, TIMEOUT } from './arbitraries';
import { order, proofPlace, trailing } from './request-arbitraries';
import { decodedOrder, decodedProof } from './request-rows';
import { oracleOrder, oracleProofPlace } from './request-support';

describe('proof place and payment order codecs', () => {
  it('encodeProofPlace equals the reference, round-trips and refuses trailing bytes', () => {
    run(
      fc.property(proofPlace, trailing, (proof, extra) => {
        const encoded = encodeProofPlace(proof);

        expect(encoded).toBe(oracleProofPlace(proof));
        expect(decodeProofPlace(encoded)).toStrictEqual(decodedProof(proof));
        expect(encodeProofPlace(decodeProofPlace(encoded))).toBe(encoded);
        expect(() => decodeProofPlace(`${encoded}${extra}`)).toThrow();
      }),
    );
  }, TIMEOUT);

  it('encodePaymentOrder equals the reference, round-trips and refuses trailing bytes', () => {
    run(
      fc.property(order, trailing, (o, extra) => {
        const encoded = encodePaymentOrder(o);

        expect(encoded).toBe(oracleOrder(o));
        expect(decodePaymentOrder(encoded)).toStrictEqual(decodedOrder(o));
        expect(encodePaymentOrder(decodePaymentOrder(encoded))).toBe(encoded);
        expect(() => decodePaymentOrder(`${encoded}${extra}`)).toThrow();
      }),
    );
  }, TIMEOUT);
});
