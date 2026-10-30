import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { approvalDigest, cancellationDigest, type ApprovalMembers, type Hex } from '../../src/index';
import { members, place, run, TIMEOUT } from './arbitraries';
import { fastKeccak, oracleApproval, oracleCancellation } from './support';

/** Replaces one member with a different value of the same width. */
const MUTATORS: Record<string, (m: ApprovalMembers) => ApprovalMembers> = {
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
        expect(approvalDigest(m, p)).toBe(oracleApproval(m, p, '1', fastKeccak));
        expect(cancellationDigest(m, p)).toBe(oracleCancellation(m, p, '1', fastKeccak));
        expect(approvalDigest(structuredClone(m), p)).toBe(approvalDigest(m, p));
      }),
    );
  }, TIMEOUT);

  it('changing any one member, or the place, changes the digest', () => {
    run(
      fc.property(members, place, fc.constantFrom(...Object.keys(MUTATORS)), (m, p, member) => {
        const changed = (MUTATORS[member] as (x: ApprovalMembers) => ApprovalMembers)(m);

        expect(approvalDigest(changed, p)).not.toBe(approvalDigest(m, p));
        expect(approvalDigest(m, p === 0 ? 1 : p - 1)).not.toBe(approvalDigest(m, p));
        expect(cancellationDigest(m, p === 0 ? 1 : p - 1)).not.toBe(cancellationDigest(m, p));

        if (APPROVAL_ONLY.has(member)) {
          expect(cancellationDigest(changed, p)).toBe(cancellationDigest(m, p));
        } else {
          expect(cancellationDigest(changed, p)).not.toBe(cancellationDigest(m, p));
        }
      }),
    );
  }, TIMEOUT);
});
