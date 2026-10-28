import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  decodeAttemptRequest,
  decodeCancelRequest,
  encodeAttemptRequest,
  encodeCancelRequest,
  type AttemptRequest,
  type CancelRequest,
  type Hex,
  type ProofPlace,
} from '../../src/index';
import { attemptOf, blessed, rowOf } from './request-rows';
import { CANCEL_BY_PROOFS_SELECTOR, oracleAttempt, oracleCancel, rawAttempt, rawCancel, START_ATTEMPT_SELECTOR } from './request-support';
import { A_ACCOUNT, A_METHOD, A_PAYEE, A_TOKEN, AN_ACTION, repeat, UINT48_MAX, UINT64_MAX, ZERO_ADDRESS } from './support';

const SALT_AA = repeat('aa', 32);
const P0: ProofPlace = { place: 0, method: A_METHOD, config: '0x1234', salt: SALT_AA, proof: '0xdeadbeef' };
const P3: ProofPlace = { place: 3, method: A_METHOD, config: '0x5678', salt: SALT_AA, proof: '0xcafe' };
const P7: ProofPlace = { place: 7, method: A_PAYEE, config: '0x', salt: repeat('00', 32), proof: '0x' };

const attempt = (overrides: Partial<AttemptRequest> = {}): AttemptRequest => ({
  account: A_ACCOUNT,
  action: AN_ACTION,
  attemptId: 9n,
  setupNonce: 7n,
  setupBody: '0xabcd',
  payload: '0xabcdef',
  order: { token: A_TOKEN, amount: 1_234_567_890_123_456_789n, payee: A_PAYEE },
  validUntil: 1_800_000_000,
  proofs: [P0, P3],
  ...overrides,
});

const cancel = (overrides: Partial<CancelRequest> = {}): CancelRequest => ({
  account: A_ACCOUNT,
  action: AN_ACTION,
  attemptId: 9n,
  setupNonce: 7n,
  setupBody: '0xabcd',
  validUntil: 1_800_000_000,
  proofs: [P0, P3],
  ...overrides,
});

const CHECKSUMMED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const BAD_CHECKSUM = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';

describe('request selectors', () => {
  it('recomputes the two selectors from the struct signatures', () => {
    expect(START_ATTEMPT_SELECTOR).toBe('0x70faa9d0');
    expect(CANCEL_BY_PROOFS_SELECTOR).toBe('0xecafb29f');
  });

  it('prefixes each encoding with its own selector', () => {
    expect(encodeAttemptRequest(attempt()).slice(0, 10)).toBe('0x70faa9d0');
    expect(encodeCancelRequest(cancel()).slice(0, 10)).toBe('0xecafb29f');
  });
});

describe('encodeAttemptRequest', () => {
  it('matches the reference encoding', () => {
    expect(encodeAttemptRequest(attempt())).toBe(oracleAttempt(attempt()));
  });

  it('sorts the proofs by place, so every order of the same proofs gives the same bytes', () => {
    const sorted = encodeAttemptRequest(attempt({ proofs: [P0, P3, P7] }));

    expect(encodeAttemptRequest(attempt({ proofs: [P7, P3, P0] }))).toBe(sorted);
    expect(encodeAttemptRequest(attempt({ proofs: [P3, P7, P0] }))).toBe(sorted);
    expect(sorted).toBe(rawAttempt(attempt({ proofs: [P0, P3, P7] })));
  });

  it('gives the blessed calldata for the blessed row with its proofs reversed', () => {
    const row = rowOf(blessed('attempt-request.json'), 'sorted-proofs');
    const request = attemptOf(row.input);

    expect(request.proofs.length).toBe(2);
    expect(encodeAttemptRequest({ ...request, proofs: [...request.proofs].reverse() })).toBe(row.expected['calldata']);
  });

  it('never reorders the caller\'s proofs array', () => {
    const proofs = [P7, P0, P3];
    const frozen = Object.freeze([...proofs]);

    encodeAttemptRequest(attempt({ proofs }));
    encodeAttemptRequest(attempt({ proofs: frozen }));
    expect(proofs).toStrictEqual([P7, P0, P3]);
    expect(frozen).toStrictEqual([P7, P0, P3]);
  });

  it('encodes one proof, zero proofs, and empty payload, body, config and proof', () => {
    for (const request of [
      attempt({ proofs: [P3] }),
      attempt({ proofs: [] }),
      attempt({ payload: '0x', setupBody: '0x', proofs: [P7] }),
      attempt({ order: { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS } }),
    ]) {
      expect(encodeAttemptRequest(request)).toBe(oracleAttempt(request));
    }
  });

  it('refuses a repeated place, adjacent or not', () => {
    expect(() => encodeAttemptRequest(attempt({ proofs: [P3, { ...P0, place: 3 }] }))).toThrow();
    expect(() => encodeAttemptRequest(attempt({ proofs: [P3, P7, { ...P0, place: 3 }] }))).toThrow();
    expect(() => encodeAttemptRequest(attempt({ proofs: [P0, P0] }))).toThrow();
  });

  it('accepts validUntil at 2^48-1 and the ids at 2^64-1, and refuses one over', () => {
    const edge = attempt({ validUntil: UINT48_MAX, attemptId: UINT64_MAX, setupNonce: UINT64_MAX });

    expect(encodeAttemptRequest(edge)).toBe(oracleAttempt(edge));
    expect(() => encodeAttemptRequest(attempt({ validUntil: UINT48_MAX + 1 }))).toThrow(RangeError);
    expect(() => encodeAttemptRequest(attempt({ attemptId: UINT64_MAX + 1n }))).toThrow(RangeError);
    expect(() => encodeAttemptRequest(attempt({ setupNonce: UINT64_MAX + 1n }))).toThrow(RangeError);
  });

  it('accepts place 0 and MAX_SAFE_INTEGER and refuses a place that is not a safe non-negative integer', () => {
    const edge = attempt({ proofs: [{ ...P3, place: Number.MAX_SAFE_INTEGER }, P0] });

    expect(encodeAttemptRequest(edge)).toBe(oracleAttempt(edge));

    for (const place of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, Number.NaN]) {
      expect(() => encodeAttemptRequest(attempt({ proofs: [{ ...P0, place }] }))).toThrow();
    }
  });

  it.each([
    ['negative ids', { attemptId: -1n }],
    ['a number attempt id', { attemptId: 9 as unknown as bigint }],
    ['a negative validUntil', { validUntil: -1 }],
    ['a fractional validUntil', { validUntil: 1.5 }],
    ['a negative amount', { order: { token: A_TOKEN, amount: -1n, payee: A_PAYEE } }],
    ['an amount of 2^256', { order: { token: A_TOKEN, amount: 1n << 256n, payee: A_PAYEE } }],
    ['odd-length payload', { payload: '0xabc' as Hex }],
    ['unprefixed setup body', { setupBody: 'abcd' as Hex }],
    ['a 31-byte salt', { proofs: [{ ...P0, salt: repeat('aa', 31) }] }],
    ['a 33-byte salt', { proofs: [{ ...P0, salt: repeat('aa', 33) }] }],
    ['a 19-byte method', { proofs: [{ ...P0, method: '0x33333333333333333333333333333333333333' as Hex }] }],
    ['a wrong-checksum account', { account: BAD_CHECKSUM as Hex }],
    ['a wrong-checksum payee', { order: { token: A_TOKEN, amount: 1n, payee: BAD_CHECKSUM as Hex } }],
    ['a wrong-checksum method', { proofs: [{ ...P0, method: BAD_CHECKSUM as Hex }] }],
    ['a missing order', { order: undefined as unknown as AttemptRequest['order'] }],
    ['proofs that are not an array', { proofs: 'nope' as unknown as ProofPlace[] }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => encodeAttemptRequest(attempt(overrides as Partial<AttemptRequest>))).toThrow();
  });

  it('gives identical bytes for all-lower, all-upper and EIP-55 addresses', () => {
    const lower = CHECKSUMMED.toLowerCase() as Hex;
    const upper = `0x${CHECKSUMMED.slice(2).toUpperCase()}` as Hex;
    const spell = (a: Hex) =>
      encodeAttemptRequest(attempt({ account: a, action: a, order: { token: a, amount: 1n, payee: a }, proofs: [{ ...P0, method: a }] }));

    expect(spell(lower)).toBe(spell(CHECKSUMMED));
    expect(spell(upper)).toBe(spell(CHECKSUMMED));
  });
});

describe('decodeAttemptRequest', () => {
  it('returns the request with its proofs sorted and every address checksummed', () => {
    const lower = CHECKSUMMED.toLowerCase() as Hex;
    const request = attempt({ account: lower, order: { token: lower, amount: 5n, payee: lower }, proofs: [P3, { ...P0, method: lower }] });
    const decoded = decodeAttemptRequest(encodeAttemptRequest(request));

    expect(decoded).toStrictEqual(
      attempt({
        account: CHECKSUMMED,
        order: { token: CHECKSUMMED, amount: 5n, payee: CHECKSUMMED },
        proofs: [{ ...P0, method: CHECKSUMMED }, P3],
      }),
    );
    expect(decoded.account).toBe(getAddress(lower));
  });

  it('round-trips zero proofs, empty members and the widest values exactly', () => {
    for (const request of [
      attempt({ proofs: [] }),
      attempt({ payload: '0x', setupBody: '0x', proofs: [P7] }),
      attempt({ validUntil: UINT48_MAX, attemptId: UINT64_MAX, setupNonce: UINT64_MAX, proofs: [{ ...P0, place: Number.MAX_SAFE_INTEGER }] }),
    ]) {
      const calldata = encodeAttemptRequest(request);

      expect(decodeAttemptRequest(calldata)).toStrictEqual(request);
      expect(encodeAttemptRequest(decodeAttemptRequest(calldata))).toBe(calldata);
    }
  });

  it('refuses the cancel selector, an unknown selector and calldata shorter than a selector', () => {
    const body = encodeAttemptRequest(attempt()).slice(10);

    expect(() => decodeAttemptRequest(`0xecafb29f${body}`)).toThrow();
    expect(() => decodeAttemptRequest(`0x00000000${body}`)).toThrow();
    expect(() => decodeAttemptRequest(`0x${body}`)).toThrow();
    expect(() => decodeAttemptRequest('0x70faa9')).toThrow();
    expect(() => decodeAttemptRequest('0x')).toThrow();
  });

  it('refuses trailing bytes, one byte or a whole word', () => {
    const calldata = encodeAttemptRequest(attempt());

    expect(() => decodeAttemptRequest(`${calldata}00`)).toThrow();
    expect(() => decodeAttemptRequest(`${calldata}${'00'.repeat(32)}`)).toThrow();
  });

  it('refuses truncated calldata and odd-length hex', () => {
    const calldata = encodeAttemptRequest(attempt());

    expect(() => decodeAttemptRequest(calldata.slice(0, -64) as Hex)).toThrow();
    expect(() => decodeAttemptRequest(`${calldata}0` as Hex)).toThrow();
  });

  it('refuses proofs out of order or with a repeated place', () => {
    expect(() => decodeAttemptRequest(rawAttempt(attempt({ proofs: [P3, P0] })))).toThrow();
    expect(() => decodeAttemptRequest(rawAttempt(attempt({ proofs: [P0, P3, { ...P7, place: 3 }] })))).toThrow();
    expect(() => decodeAttemptRequest(rawAttempt(attempt({ proofs: [P0, P0] })))).toThrow();
  });

  it('refuses a place word above MAX_SAFE_INTEGER rather than wrapping it', () => {
    const calldata = rawAttempt(attempt({ proofs: [P0] }));
    const word = (2n ** 53n).toString(16).padStart(64, '0');
    const zero = '0'.repeat(64);
    const patched = calldata.replace(`${zero}000000000000000000000000${A_METHOD.slice(2)}`, `${word}000000000000000000000000${A_METHOD.slice(2)}`);

    expect(patched).not.toBe(calldata);
    expect(() => decodeAttemptRequest(patched as Hex)).toThrow();
  });
});

describe('encodeCancelRequest and decodeCancelRequest', () => {
  it('matches the reference encoding and carries no payload and no order', () => {
    const calldata = encodeCancelRequest(cancel());

    expect(calldata).toBe(oracleCancel(cancel()));
    expect(calldata).not.toContain('abcdef');
    expect(calldata).not.toContain(A_TOKEN.slice(2));
  });

  it('sorts the proofs, refuses a repeat and leaves the caller\'s array alone', () => {
    const proofs = [P7, P3, P0];

    expect(encodeCancelRequest(cancel({ proofs }))).toBe(rawCancel(cancel({ proofs: [P0, P3, P7] })));
    expect(proofs).toStrictEqual([P7, P3, P0]);
    expect(() => encodeCancelRequest(cancel({ proofs: [P0, { ...P3, place: 0 }] }))).toThrow();
  });

  it('round-trips one proof, zero proofs and the widest values exactly', () => {
    for (const request of [
      cancel({ proofs: [P3] }),
      cancel({ proofs: [] }),
      cancel({ setupBody: '0x', validUntil: UINT48_MAX, attemptId: UINT64_MAX, setupNonce: UINT64_MAX }),
    ]) {
      const calldata = encodeCancelRequest(request);

      expect(calldata).toBe(oracleCancel(request));
      expect(decodeCancelRequest(calldata)).toStrictEqual(request);
    }
  });

  it('refuses one over each width', () => {
    expect(() => encodeCancelRequest(cancel({ validUntil: UINT48_MAX + 1 }))).toThrow(RangeError);
    expect(() => encodeCancelRequest(cancel({ attemptId: UINT64_MAX + 1n }))).toThrow(RangeError);
    expect(() => encodeCancelRequest(cancel({ setupNonce: UINT64_MAX + 1n }))).toThrow(RangeError);
  });

  it('refuses the attempt selector, trailing bytes and unsorted places', () => {
    const calldata = encodeCancelRequest(cancel());

    expect(() => decodeCancelRequest(`0x70faa9d0${calldata.slice(10)}`)).toThrow();
    expect(() => decodeCancelRequest(`${calldata}00`)).toThrow();
    expect(() => decodeCancelRequest(rawCancel(cancel({ proofs: [P3, P0] })))).toThrow();
    expect(() => decodeCancelRequest(rawCancel(cancel({ proofs: [P3, P3] })))).toThrow();
  });

  it('never decodes attempt calldata as a cancellation', () => {
    expect(() => decodeCancelRequest(encodeAttemptRequest(attempt()))).toThrow();
    expect(() => decodeAttemptRequest(encodeCancelRequest(cancel()))).toThrow();
  });
});
