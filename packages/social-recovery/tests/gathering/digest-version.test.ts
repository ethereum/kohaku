import { hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  type ApprovalMembers,
} from '../../src/index';
import { ACCOUNT, ACTION, approvalGathering, cancellationGathering, digestOf, MANAGER, PAYEE, TOKEN, vectorExpected } from './support';

const APPROVAL_DIGEST = vectorExpected('approval-digest.json', 'normal')['digest'];
const CANCELLATION_DIGEST = vectorExpected('cancellation-digest.json', 'normal')['digest'];

/** The blessed rows' members, with an optional digest version. */
function members(digestVersion?: unknown): ApprovalMembers {
  const base: ApprovalMembers = {
    chainId: 1,
    manager: MANAGER,
    account: ACCOUNT,
    action: ACTION,
    attemptId: 9n,
    setupNonce: 7n,
    setupBodyHash: '0x6b359609fb43fd6343d702b855975035a90d454cb081cb662938e219a51a1160',
    validUntil: 1_800_000_000,
    payload: '0xabcdef',
    order: { token: TOKEN, amount: 1_234_567_890_123_456_789n, payee: PAYEE },
  };

  return (digestVersion === undefined ? base : { ...base, digestVersion }) as ApprovalMembers;
}

const BUILDERS = [
  ['approvalDigest', (m: ApprovalMembers) => approvalDigest(m, 0)],
  ['cancellationDigest', (m: ApprovalMembers) => cancellationDigest(m, 0)],
  ['approvalTypedData', (m: ApprovalMembers) => approvalTypedData(m, 0)],
  ['cancellationTypedData', (m: ApprovalMembers) => cancellationTypedData(m, 0)],
] as const;

describe('the digest builders and the domain version', () => {
  it('give the blessed digests for version "1" and for an absent version', () => {
    for (const m of [members(), members('1')]) {
      expect(approvalDigest(m, 0)).toBe(APPROVAL_DIGEST);
      expect(cancellationDigest(m, 0)).toBe(CANCELLATION_DIGEST);
      expect(approvalTypedData(m, 0).domain.version).toBe('1');
      expect(cancellationTypedData(m, 0).domain.version).toBe('1');
    }
  });

  it('derive under version "2" the digest viem gives for that domain', () => {
    const v2 = { ...approvalGathering(), request: { ...approvalGathering().request, digestVersion: '2' } };
    const c2 = { ...cancellationGathering(), request: { ...cancellationGathering().request, digestVersion: '2' } };

    expect(approvalDigest(members('2'), 0)).toBe(digestOf(v2, 0));
    expect(cancellationDigest(members('2'), 0)).toBe(digestOf(c2, 0));
    expect(hashTypedData(approvalTypedData(members('2'), 0) as Parameters<typeof hashTypedData>[0])).toBe(digestOf(v2, 0));
  });

  it.each(BUILDERS.flatMap(([name, build]) => [
    [name, 'an empty string', '', build],
    [name, 'the number 1', 1, build],
    [name, 'a non-decimal string', 'x', build],
  ] as const))('%s throws on %s as the digest version', (_name, _label, version, build) => {
    expect(() => build(members(version))).toThrow();
  });
});
