import { describe, expect, it } from 'vitest';
import {
  decodePaymentOrder,
  decodeProofPlace,
  encodePaymentOrder,
  encodeProofPlace,
  type Hex,
  type PaymentOrder,
  type ProofPlace,
} from '../../src/index';
import { oracleOrder, oracleProofPlace } from './request-support';
import { A_METHOD, A_PAYEE, A_TOKEN, repeat, UINT256_MAX, word, ZERO_ADDRESS } from './support';

const PROOF: ProofPlace = { place: 2, method: A_METHOD, config: '0x1234', salt: repeat('aa', 32), proof: '0xdeadbeef' };
const ORDER: PaymentOrder = { token: A_TOKEN, amount: 1_234_567_890_123_456_789n, payee: A_PAYEE };
const CHECKSUMMED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const BAD_CHECKSUM = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';

describe('encodeProofPlace and decodeProofPlace', () => {
  it('encodes one tuple, led by its 0x20 offset word', () => {
    const encoded = encodeProofPlace(PROOF);

    expect(encoded).toBe(oracleProofPlace(PROOF));
    expect(encoded.slice(2, 66)).toBe(word(0x20));
    expect(encoded.slice(66, 130)).toBe(word(2));
  });

  it.each([
    ['place 0 with empty config and proof and a zero salt', { ...PROOF, place: 0, config: '0x', proof: '0x', salt: repeat('00', 32) }],
    ['place MAX_SAFE_INTEGER', { ...PROOF, place: Number.MAX_SAFE_INTEGER }],
    ['a 32-byte config and a 33-byte proof', { ...PROOF, config: repeat('5a', 32), proof: repeat('01', 33) }],
  ])('round-trips %s', (_label, proof) => {
    const encoded = encodeProofPlace(proof as ProofPlace);

    expect(encoded).toBe(oracleProofPlace(proof as ProofPlace));
    expect(decodeProofPlace(encoded)).toStrictEqual(proof);
  });

  it('decodes the method checksummed whatever spelling encoded it', () => {
    const lower = encodeProofPlace({ ...PROOF, method: CHECKSUMMED.toLowerCase() as Hex });

    expect(lower).toBe(encodeProofPlace({ ...PROOF, method: `0x${CHECKSUMMED.slice(2).toUpperCase()}` }));
    expect(decodeProofPlace(lower).method).toBe(CHECKSUMMED);
  });

  it.each([
    ['a place above MAX_SAFE_INTEGER', { place: Number.MAX_SAFE_INTEGER + 1 }],
    ['a negative place', { place: -1 }],
    ['a fractional place', { place: 0.5 }],
    ['a bigint place', { place: 2n as unknown as number }],
    ['a 31-byte salt', { salt: repeat('aa', 31) }],
    ['odd-length config', { config: '0x123' }],
    ['a wrong-checksum method', { method: BAD_CHECKSUM }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => encodeProofPlace({ ...PROOF, ...(overrides as Partial<ProofPlace>) })).toThrow();
  });

  it('refuses trailing bytes and a place word above MAX_SAFE_INTEGER on decode', () => {
    const encoded = encodeProofPlace(PROOF);
    const wide = `0x${encoded.slice(2, 66)}${word(2n ** 53n)}${encoded.slice(130)}` as Hex;

    expect(() => decodeProofPlace(`${encoded}00`)).toThrow();
    expect(() => decodeProofPlace(`${encoded}${word(0)}`)).toThrow();
    expect(() => decodeProofPlace(wide)).toThrow();
    expect(() => decodeProofPlace('0x')).toThrow();
  });
});

describe('encodePaymentOrder and decodePaymentOrder', () => {
  it('is three static words, token, amount, payee, with no offset', () => {
    const encoded = encodePaymentOrder(ORDER);

    expect(encoded.length).toBe(2 + 96 * 2);
    expect(encoded).toBe(oracleOrder(ORDER));
  });

  it.each([
    ['the zero order', { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS }],
    ['an amount of 2^256-1', { ...ORDER, amount: UINT256_MAX }],
    ['a native payment with an open payee', { token: ZERO_ADDRESS, amount: 1n, payee: ZERO_ADDRESS }],
  ])('round-trips %s', (_label, order) => {
    const encoded = encodePaymentOrder(order as PaymentOrder);

    expect(encoded).toBe(oracleOrder(order as PaymentOrder));
    expect(decodePaymentOrder(encoded)).toStrictEqual(order);
  });

  it('accepts every valid spelling with identical bytes and decodes to the checksummed one', () => {
    const lower = CHECKSUMMED.toLowerCase() as Hex;
    const upper = `0x${CHECKSUMMED.slice(2).toUpperCase()}` as Hex;
    const encoded = encodePaymentOrder({ token: CHECKSUMMED, amount: 3n, payee: CHECKSUMMED });

    expect(encodePaymentOrder({ token: lower, amount: 3n, payee: upper })).toBe(encoded);
    expect(decodePaymentOrder(encoded)).toStrictEqual({ token: CHECKSUMMED, amount: 3n, payee: CHECKSUMMED });
  });

  it.each([
    ['an amount of 2^256', { amount: 1n << 256n }],
    ['a negative amount', { amount: -1n }],
    ['a number amount', { amount: 1 as unknown as bigint }],
    ['a wrong-checksum token', { token: BAD_CHECKSUM }],
    ['a 21-byte payee', { payee: `${A_PAYEE}55` }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => encodePaymentOrder({ ...ORDER, ...(overrides as Partial<PaymentOrder>) })).toThrow();
  });

  it('refuses trailing, missing and dirty address bytes on decode', () => {
    const encoded = encodePaymentOrder(ORDER);
    const dirty = `0x${'01'}${encoded.slice(4)}` as Hex;

    expect(() => decodePaymentOrder(`${encoded}00`)).toThrow();
    expect(() => decodePaymentOrder(encoded.slice(0, -2) as Hex)).toThrow();
    expect(() => decodePaymentOrder(dirty)).toThrow();
  });
});
