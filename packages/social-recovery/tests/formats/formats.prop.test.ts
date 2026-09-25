import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  cancellationDigest,
  credentialHash,
  decodeSetupBody,
  encodeSetupBody,
  setupCommitment,
  type ApprovalMembers,
  type SetupBody,
} from '../../src/index';
import {
  fastKeccak,
  oracleApproval,
  oracleBody,
  oracleCancellation,
  oracleCommitment,
  oracleCredential,
  UINT256_MAX,
  UINT48_MAX,
  UINT64_MAX,
  type Hex,
  type Members,
} from './support';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];
const params: fc.Parameters<unknown> = seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) };
/** A per-test timeout that grows with the run count, never below vitest's 5 s default. */
const TIMEOUT = Math.max(5_000, numRuns * 10);
const run = <T>(property: fc.IProperty<T>): void => fc.assert(property, params as fc.Parameters<T>);

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;
const bytesN = (n: number): fc.Arbitrary<Hex> => fc.uint8Array({ minLength: n, maxLength: n }).map(toHex);
const anyBytes = fc.uint8Array({ maxLength: 96 }).map(toHex);
const address = bytesN(20);
const uint = (bits: number): fc.Arbitrary<bigint> => fc.bigInt({ min: 0n, max: (1n << BigInt(bits)) - 1n });
const safeInt = (min: number, max: number): fc.Arbitrary<number> =>
  fc.bigInt({ min: BigInt(min), max: BigInt(max) }).map(Number);
const uint48 = fc.oneof(fc.constantFrom(0, UINT48_MAX), safeInt(0, UINT48_MAX));
const place = fc.oneof(fc.nat(64), safeInt(0, Number.MAX_SAFE_INTEGER));

const clause = fc.record({ threshold: fc.integer({ min: 0, max: 255 }), credentials: fc.array(bytesN(32), { maxLength: 5 }) });
const body: fc.Arbitrary<SetupBody> = fc.record({
  wait: uint48,
  ignoresPause: fc.boolean(),
  clauses: fc.array(clause, { maxLength: 5 }),
});

const members: fc.Arbitrary<Members> = fc.record({
  chainId: safeInt(0, Number.MAX_SAFE_INTEGER),
  manager: address,
  account: address,
  action: address,
  attemptId: uint(64),
  setupNonce: uint(64),
  setupBodyHash: bytesN(32),
  validUntil: uint48,
  payload: anyBytes,
  order: fc.record({ token: address, amount: uint(256), payee: address }),
});

describe('setup body codec', () => {
  it('encodes every valid body to the reference abi.encode and decodes back to it', () => {
    run(
      fc.property(body, (b) => {
        const encoded = encodeSetupBody(b);

        expect(encoded).toBe(oracleBody(b));
        expect(decodeSetupBody(encoded)).toEqual(b);
        expect(encodeSetupBody(decodeSetupBody(encoded))).toBe(encoded);
      }),
    );
  }, TIMEOUT);

  it('is deterministic', () => {
    run(
      fc.property(body, (b) => {
        expect(encodeSetupBody(b)).toBe(encodeSetupBody(structuredClone(b)));
      }),
    );
  }, TIMEOUT);

  it('refuses a wait or threshold outside its width', () => {
    run(
      fc.property(body, safeInt(2 ** 48, Number.MAX_SAFE_INTEGER), fc.integer({ min: 256, max: 2 ** 31 - 1 }), (b, wait, threshold) => {
        expect(() => encodeSetupBody({ ...b, wait })).toThrow(RangeError);
        expect(() => encodeSetupBody({ ...b, clauses: [...b.clauses, { threshold, credentials: [] }] })).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);

  it('refuses a credential that is not exactly 32 bytes and odd-length body bytes', () => {
    run(
      fc.property(body, fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32), (b, n) => {
        const bad = `0x${'ab'.repeat(n)}` as Hex;

        expect(() => encodeSetupBody({ ...b, clauses: [{ threshold: 1, credentials: [bad] }] })).toThrow(TypeError);
        expect(() => decodeSetupBody(`${encodeSetupBody(b)}0` as Hex)).toThrow(TypeError);
      }),
    );
  }, TIMEOUT);
});

describe('commitments', () => {
  it('credentialHash equals the reference abi.encode preimage hash and is deterministic', () => {
    run(
      fc.property(address, anyBytes, bytesN(32), (method, config, salt) => {
        const expected = oracleCredential(method, config, salt);

        expect(credentialHash(method, config, salt)).toBe(expected);
        expect(credentialHash(getAddress(method), config, salt)).toBe(expected);
      }),
    );
  }, TIMEOUT);

  it('setupCommitment equals the reference and refuses a nonce outside uint64', () => {
    run(
      fc.property(address, address, uint(64), anyBytes, fc.bigInt({ min: 1n << 64n, max: 1n << 80n }), (account, action, nonce, b, big) => {
        expect(setupCommitment(account, action, nonce, b)).toBe(oracleCommitment(account, action, nonce, b));
        expect(() => setupCommitment(account, action, big, b)).toThrow(RangeError);
        expect(() => setupCommitment(account, action, -nonce - 1n, b)).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);
});

const asMembers = (m: Members): ApprovalMembers => m;

/** Replaces one member with a different value of the same width. */
const MUTATORS: Record<string, (m: Members) => Members> = {
  chainId: (m) => ({ ...m, chainId: m.chainId === 0 ? 1 : m.chainId - 1 }),
  manager: (m) => ({ ...m, manager: flip(m.manager) }),
  account: (m) => ({ ...m, account: flip(m.account) }),
  action: (m) => ({ ...m, action: flip(m.action) }),
  attemptId: (m) => ({ ...m, attemptId: m.attemptId ^ 1n }),
  setupNonce: (m) => ({ ...m, setupNonce: m.setupNonce ^ (1n << 63n) }),
  setupBodyHash: (m) => ({ ...m, setupBodyHash: flip(m.setupBodyHash) }),
  validUntil: (m) => ({ ...m, validUntil: m.validUntil === 0 ? 1 : m.validUntil - 1 }),
  payload: (m) => ({ ...m, payload: m.payload === '0x' ? '0x00' : (m.payload.slice(0, -2) as Hex) }),
  'order.token': (m) => ({ ...m, order: { ...m.order, token: flip(m.order.token) } }),
  'order.amount': (m) => ({ ...m, order: { ...m.order, amount: m.order.amount ^ 1n } }),
  'order.payee': (m) => ({ ...m, order: { ...m.order, payee: flip(m.order.payee) } }),
};
const APPROVAL_ONLY = new Set(['payload', 'order.token', 'order.amount', 'order.payee']);

function flip(hex: Hex): Hex {
  const last = parseInt(hex.slice(-1), 16) ^ 1;

  return `${hex.slice(0, -1)}${last.toString(16)}` as Hex;
}

describe('digests', () => {
  it('equal the hand-assembled EIP-712 digests and are deterministic', () => {
    run(
      fc.property(members, place, (m, p) => {
        expect(approvalDigest(asMembers(m), p)).toBe(oracleApproval(m, p, '1', fastKeccak));
        expect(cancellationDigest(asMembers(m), p)).toBe(oracleCancellation(m, p, '1', fastKeccak));
        expect(approvalDigest(asMembers(structuredClone(m)), p)).toBe(approvalDigest(asMembers(m), p));
      }),
    );
  }, TIMEOUT);

  it('an approval and a cancellation over the same members differ', () => {
    run(
      fc.property(members, place, (m, p) => {
        expect(approvalDigest(asMembers(m), p)).not.toBe(cancellationDigest(asMembers(m), p));
      }),
    );
  }, TIMEOUT);

  it('changing any one member, or the place, changes the digest', () => {
    run(
      fc.property(members, place, fc.constantFrom(...Object.keys(MUTATORS)), (m, p, member) => {
        const changed = (MUTATORS[member] as (x: Members) => Members)(m);

        expect(approvalDigest(asMembers(changed), p)).not.toBe(approvalDigest(asMembers(m), p));
        expect(approvalDigest(asMembers(m), p === 0 ? 1 : p - 1)).not.toBe(approvalDigest(asMembers(m), p));
        expect(cancellationDigest(asMembers(m), p === 0 ? 1 : p - 1)).not.toBe(cancellationDigest(asMembers(m), p));

        if (APPROVAL_ONLY.has(member)) {
          expect(cancellationDigest(asMembers(changed), p)).toBe(cancellationDigest(asMembers(m), p));
        } else {
          expect(cancellationDigest(asMembers(changed), p)).not.toBe(cancellationDigest(asMembers(m), p));
        }
      }),
    );
  }, TIMEOUT);

  it('refuses ids, nonces, windows, amounts and places outside their widths', () => {
    const over = (bits: number): fc.Arbitrary<bigint> => fc.bigInt({ min: 1n << BigInt(bits), max: 1n << BigInt(bits + 16) });

    run(
      fc.property(members, over(64), over(256), safeInt(2 ** 48, Number.MAX_SAFE_INTEGER), fc.integer({ min: -(2 ** 31), max: -1 }), (m, big64, big256, wide, negative) => {
        expect(() => approvalDigest(asMembers({ ...m, attemptId: big64 }), 0)).toThrow(RangeError);
        expect(() => cancellationDigest(asMembers({ ...m, setupNonce: big64 }), 0)).toThrow(RangeError);
        expect(() => cancellationDigest(asMembers({ ...m, validUntil: wide }), 0)).toThrow(RangeError);
        expect(() => approvalDigest(asMembers({ ...m, order: { ...m.order, amount: big256 } }), 0)).toThrow(RangeError);
        expect(() => approvalDigest(asMembers(m), negative)).toThrow(RangeError);
        expect(() => cancellationDigest(asMembers(m), negative)).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);

  it('accepts the width maxima', () => {
    run(
      fc.property(members, (m) => {
        const max = { ...m, attemptId: UINT64_MAX, setupNonce: UINT64_MAX, validUntil: UINT48_MAX, order: { ...m.order, amount: UINT256_MAX } };

        expect(approvalDigest(asMembers(max), Number.MAX_SAFE_INTEGER)).toBe(oracleApproval(max, Number.MAX_SAFE_INTEGER, '1', fastKeccak));
      }),
    );
  }, TIMEOUT);
});
