import fc from 'fast-check';
import { hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import { approvalDigest, approvalTypedData, cancellationDigest, cancellationTypedData } from '../../src/index';
import { members, place, run, TIMEOUT } from './arbitraries';
import { UINT256_MAX } from './support';

const wide = fc.bigInt({ min: BigInt(Number.MAX_SAFE_INTEGER) + 1n, max: UINT256_MAX });

describe('digest place, a uint256 taken as a number or a bigint', () => {
  it('a safe-integer place digests alike as a number and as a bigint', () => {
    run(
      fc.property(members, place, (m, p) => {
        expect(approvalDigest(m, p)).toBe(approvalDigest(m, BigInt(p)));
        expect(cancellationDigest(m, p)).toBe(cancellationDigest(m, BigInt(p)));
        expect(approvalTypedData(m, p)).toStrictEqual(approvalTypedData(m, BigInt(p)));
        expect(cancellationTypedData(m, p)).toStrictEqual(cancellationTypedData(m, BigInt(p)));
      }),
    );
  }, TIMEOUT);

  it('the typed-data message carries the place as a bigint, whichever form it was given', () => {
    run(
      fc.property(members, place, (m, p) => {
        for (const given of [p, BigInt(p)]) {
          expect(typeof approvalTypedData(m, given).message.place).toBe('bigint');
          expect(cancellationTypedData(m, given).message.place).toBe(BigInt(p));
        }
      }),
    );
  }, TIMEOUT);

  it('a place past the safe integers digests as viem hashes its typed data', () => {
    run(
      fc.property(members, wide, (m, p) => {
        const approval = approvalTypedData(m, p);
        const cancellation = cancellationTypedData(m, p);

        expect(approval.message.place).toBe(p);
        expect(approvalDigest(m, p)).toBe(hashTypedData(approval));
        expect(cancellationDigest(m, p)).toBe(hashTypedData(cancellation));
        expect(approvalDigest(m, p)).not.toBe(approvalDigest(m, p - 1n));
      }),
    );
  }, TIMEOUT);

  it('refuses a bigint place of 2^256 and above, or below zero, with a RangeError', () => {
    const over = fc.bigInt({ min: UINT256_MAX + 1n, max: UINT256_MAX << 8n });
    const under = fc.bigInt({ min: -(UINT256_MAX + 1n), max: -1n });

    run(
      fc.property(members, fc.oneof(over, under, fc.constantFrom(2n ** 256n, -1n)), (m, p) => {
        expect(() => approvalDigest(m, p)).toThrow(RangeError);
        expect(() => cancellationDigest(m, p)).toThrow(RangeError);
        expect(() => approvalTypedData(m, p)).toThrow(RangeError);
        expect(() => cancellationTypedData(m, p)).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);

  it('accepts the bigint place 2^256 - 1', () => {
    run(
      fc.property(members, (m) => {
        expect(cancellationDigest(m, UINT256_MAX)).toBe(hashTypedData(cancellationTypedData(m, UINT256_MAX)));
      }),
    );
  }, TIMEOUT);

  it.each([
    ['a negative number', -1, RangeError],
    ['a fractional number', 1.5, TypeError],
    ['a number past the safe integers', Number.MAX_SAFE_INTEGER + 1, RangeError],
  ])('still refuses %s place as before', (_label, given, error) => {
    run(
      fc.property(members, (m) => {
        expect(() => approvalTypedData(m, given)).toThrow(error);
        expect(() => cancellationTypedData(m, given)).toThrow(error);
      }),
    );
  }, TIMEOUT);
});
