import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { approvalDigest, cancellationDigest } from '../../src/index';
import { members, place, run, safeInt, TIMEOUT } from './arbitraries';
import { fastKeccak, oracleApproval, UINT256_MAX, UINT48_MAX, UINT64_MAX } from './support';

describe('digests', () => {
  it('an approval and a cancellation over the same members differ', () => {
    run(
      fc.property(members, place, (m, p) => {
        expect(approvalDigest(m, p)).not.toBe(cancellationDigest(m, p));
      }),
    );
  }, TIMEOUT);

  it('refuses ids, nonces, windows, amounts and places outside their widths', () => {
    const over = (bits: number): fc.Arbitrary<bigint> => fc.bigInt({ min: 1n << BigInt(bits), max: 1n << BigInt(bits + 16) });

    run(
      fc.property(members, over(64), over(256), safeInt(2 ** 48, Number.MAX_SAFE_INTEGER), fc.integer({ min: -(2 ** 31), max: -1 }), (m, big64, big256, wide, negative) => {
        expect(() => approvalDigest({ ...m, attemptId: big64 }, 0)).toThrow(RangeError);
        expect(() => cancellationDigest({ ...m, setupNonce: big64 }, 0)).toThrow(RangeError);
        expect(() => cancellationDigest({ ...m, validUntil: wide }, 0)).toThrow(RangeError);
        expect(() => approvalDigest({ ...m, order: { ...m.order, amount: big256 } }, 0)).toThrow(RangeError);
        expect(() => approvalDigest(m, negative)).toThrow(RangeError);
        expect(() => cancellationDigest(m, negative)).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);

  it('accepts the width maxima', () => {
    run(
      fc.property(members, (m) => {
        const max = { ...m, attemptId: UINT64_MAX, setupNonce: UINT64_MAX, validUntil: UINT48_MAX, order: { ...m.order, amount: UINT256_MAX } };

        expect(approvalDigest(max, Number.MAX_SAFE_INTEGER)).toBe(oracleApproval(max, Number.MAX_SAFE_INTEGER, '1', fastKeccak));
      }),
    );
  }, TIMEOUT);
});
