import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  decodeAttemptRequest,
  decodeCancelRequest,
  decodePaymentOrder,
  decodeProofPlace,
  encodeAttemptRequest,
  encodeCancelRequest,
  encodePaymentOrder,
  encodeProofPlace,
  type Address,
  type AttemptRequest,
  type CancelRequest,
  type Hex,
} from '../../src/index';
import { normalizeAddress } from '../../src/formats/guards';
import { attemptOf, blessed, cancelOf, decodedAttempt, decodedCancel, fixture, rowOf } from './request-rows';
import { oracleAttempt, oracleCancel } from './request-support';
import { repeat } from './support';

const ACCOUNT: Address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const ACTION: Address = '0x0F2AA7bcda3d9D210dF69a394b6965CB2566c828';
const TOKEN: Address = '0x26cE6745A633030A6faC5e64e41D21fb6246dc2d';
const PAYEE: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const METHOD: Address = '0xd3Cb18981303435Bf626edC1C1F71eb0034E8a36';

const lower = (a: Address): Address => a.toLowerCase() as Address;

/** An attempt whose every address is spelled in lower case, so the decoder alone must checksum it. */
const ATTEMPT: AttemptRequest = {
  account: lower(ACCOUNT),
  action: lower(ACTION),
  attemptId: 9n,
  setupNonce: 7n,
  setupBody: '0xabcd',
  payload: '0xabcdef',
  order: { token: lower(TOKEN), amount: 5n, payee: lower(PAYEE) },
  validUntil: 1_800_000_000,
  proofs: [{ place: 1, method: lower(METHOD), config: '0x12', salt: repeat('aa', 32), proof: '0xbeef' }],
};

const CANCEL: CancelRequest = {
  account: ATTEMPT.account,
  action: ATTEMPT.action,
  attemptId: ATTEMPT.attemptId,
  setupNonce: ATTEMPT.setupNonce,
  setupBody: ATTEMPT.setupBody,
  validUntil: ATTEMPT.validUntil,
  proofs: ATTEMPT.proofs,
};

/** Every hex digit upper case, the `0x` prefix kept. */
const upper = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;

/** Every other hex digit upper case, the `0x` prefix kept. */
const mixed = (hex: Hex): Hex =>
  `0x${[...hex.slice(2)].map((c, index) => (index % 2 === 0 ? c.toUpperCase() : c)).join('')}`;

const ATTEMPT_SELECTOR_REFUSAL = 'calldata does not open with the startAttempt selector 0x70faa9d0';
const CANCEL_SELECTOR_REFUSAL = 'calldata does not open with the cancelByProofs selector 0xecafb29f';

describe('the request decoders read hex of any letter case alike', () => {
  const attemptCalldata = encodeAttemptRequest(ATTEMPT);
  const cancelCalldata = encodeCancelRequest(CANCEL);

  it('encodes the lower-case reference calldata', () => {
    expect(attemptCalldata).toBe(oracleAttempt(ATTEMPT));
    expect(cancelCalldata).toBe(oracleCancel(CANCEL));
    expect(attemptCalldata).toBe(attemptCalldata.toLowerCase());
  });

  it.each([
    ['upper', upper],
    ['mixed', mixed],
  ])('decodes %s-case attempt calldata exactly as lower case', (_label, spell) => {
    expect(spell(attemptCalldata)).not.toBe(attemptCalldata);
    expect(decodeAttemptRequest(spell(attemptCalldata))).toStrictEqual(decodeAttemptRequest(attemptCalldata));
  });

  it.each([
    ['upper', upper],
    ['mixed', mixed],
  ])('decodes %s-case cancel calldata exactly as lower case', (_label, spell) => {
    expect(decodeCancelRequest(spell(cancelCalldata))).toStrictEqual(decodeCancelRequest(cancelCalldata));
  });

  it('decodes the blessed rows written in upper case to the same requests', () => {
    const attemptRow = rowOf(blessed('attempt-request.json'), 'sorted-proofs');
    const cancelRow = rowOf(blessed('cancel-request.json'), 'one-proof');

    expect(decodeAttemptRequest(upper(attemptRow.expected['calldata'] as Hex))).toStrictEqual(decodedAttempt(attemptOf(attemptRow.input)));
    expect(decodeCancelRequest(upper(cancelRow.expected['calldata'] as Hex))).toStrictEqual(decodedCancel(cancelOf(cancelRow.input)));
  });

  it('refuses the other request\'s selector written in upper case with the selector message', () => {
    expect(() => decodeAttemptRequest(`0xECAFB29F${attemptCalldata.slice(10)}`)).toThrow(new RangeError(ATTEMPT_SELECTOR_REFUSAL));
    expect(() => decodeCancelRequest(`0x70FAA9D0${cancelCalldata.slice(10)}`)).toThrow(new RangeError(CANCEL_SELECTOR_REFUSAL));
  });

  it('refuses an unknown upper-case selector and a whole upper-case call of the other kind with the selector message', () => {
    expect(() => decodeAttemptRequest(`0xDEADBEEF${attemptCalldata.slice(10)}`)).toThrow(new RangeError(ATTEMPT_SELECTOR_REFUSAL));
    expect(() => decodeAttemptRequest(upper(cancelCalldata))).toThrow(new RangeError(ATTEMPT_SELECTOR_REFUSAL));
    expect(() => decodeCancelRequest(upper(attemptCalldata))).toThrow(new RangeError(CANCEL_SELECTOR_REFUSAL));
  });
});

describe('the component decoders read hex of any letter case alike', () => {
  const placeBytes = encodeProofPlace(ATTEMPT.proofs[0]!);
  const orderBytes = encodePaymentOrder(ATTEMPT.order);

  it.each([
    ['upper', upper],
    ['mixed', mixed],
  ])('decodes a %s-case proof place and payment order exactly as lower case', (_label, spell) => {
    expect(decodeProofPlace(spell(placeBytes))).toStrictEqual(decodeProofPlace(placeBytes));
    expect(decodePaymentOrder(spell(orderBytes))).toStrictEqual(decodePaymentOrder(orderBytes));
  });
});

describe('the request decoders return checksummed addresses', () => {
  const attempt = decodeAttemptRequest(encodeAttemptRequest(ATTEMPT));
  const cancel = decodeCancelRequest(encodeCancelRequest(CANCEL));

  it('spells every decoded attempt address in EIP-55, equal to the address guard\'s output', () => {
    const decoded = [attempt.account, attempt.action, attempt.order.token, attempt.order.payee, attempt.proofs[0]?.method];

    expect(decoded).toStrictEqual([ACCOUNT, ACTION, TOKEN, PAYEE, METHOD]);
    expect(decoded).toStrictEqual(decoded.map((a) => normalizeAddress(lower(a as Address), 'address')));
    expect(decoded).toStrictEqual(decoded.map((a) => getAddress(a as Address)));
  });

  it('spells every decoded cancel address in EIP-55', () => {
    expect([cancel.account, cancel.action, cancel.proofs[0]?.method]).toStrictEqual([ACCOUNT, ACTION, METHOD]);
    expect(cancel.account).toBe(normalizeAddress(CANCEL.account, 'account'));
  });

  it('returns only the request\'s own members', () => {
    expect(Object.keys(attempt).sort()).toStrictEqual(
      ['account', 'action', 'attemptId', 'order', 'payload', 'proofs', 'setupBody', 'setupNonce', 'validUntil'],
    );
    expect(Object.keys(cancel).sort()).toStrictEqual(['account', 'action', 'attemptId', 'proofs', 'setupBody', 'setupNonce', 'validUntil']);
    expect(Object.keys(attempt.order).sort()).toStrictEqual(['amount', 'payee', 'token']);
  });

  it('decodes every blessed and fixture attempt and cancel row to checksummed addresses', () => {
    const attempts = [...blessed('attempt-request.json').vectors, ...fixture('attempt-request-boundaries.json').vectors];
    const cancels = [...blessed('cancel-request.json').vectors, ...fixture('cancel-request-boundaries.json').vectors];

    for (const row of attempts) {
      const decoded = decodeAttemptRequest(row.expected['calldata'] as Hex);
      const addresses = [decoded.account, decoded.action, decoded.order.token, decoded.order.payee, ...decoded.proofs.map((p) => p.method)];

      expect(addresses).toStrictEqual(addresses.map((a) => getAddress(a.toLowerCase())));
    }

    for (const row of cancels) {
      const decoded = decodeCancelRequest(row.expected['calldata'] as Hex);
      const addresses = [decoded.account, decoded.action, ...decoded.proofs.map((p) => p.method)];

      expect(addresses).toStrictEqual(addresses.map((a) => getAddress(a.toLowerCase())));
    }
  });
});
