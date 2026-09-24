import { hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  DIGEST_VERSION,
  type ApprovalMembers,
} from '../../src/index';
import {
  A_METHOD,
  baseMembers,
  domainSeparator,
  keccakText,
  oracleApproval,
  oracleCancellation,
  repeat,
  UINT256_MAX,
  UINT48_MAX,
  UINT64_MAX,
  ZERO_ADDRESS,
  type Members,
} from './support';

const members = (overrides: Partial<Members> = {}): ApprovalMembers => ({ ...baseMembers(), ...overrides });

describe('the EIP-712 constants, derived by hand', () => {
  it('type hashes and the domain separator of the blessed row', () => {
    expect(keccakText('PaymentOrder(address token,uint256 amount,address payee)')).toBe(
      '0xd266fdd5b7ff41fca6a893b6ecd7a4242c11cc5e7ffb0ebfffb23e751e24667f',
    );
    expect(domainSeparator(1, '0x6666666666666666666666666666666666666666', '1')).toBe(
      '0x9368d985864d6c8830e358075c68babf5c398e63dec0aec298ed681b26a9703c',
    );
  });
});

describe('approvalDigest and cancellationDigest', () => {
  it('reproduce the hand-assembled digests of the blessed members', () => {
    expect(oracleApproval(baseMembers(), 0)).toBe('0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339');
    expect(oracleCancellation(baseMembers(), 0)).toBe('0x45da43ac350a49f946b432051597379c9c780adb797231750744a4bcc6df4f87');
    expect(approvalDigest(members(), 0)).toBe(oracleApproval(baseMembers(), 0));
    expect(cancellationDigest(members(), 0)).toBe(oracleCancellation(baseMembers(), 0));
  });

  it.each([
    ['empty payload', { payload: '0x' as const }, 0],
    ['zero order (nobody paid, open payee)', { order: { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS } }, 0],
    ['maximum amount', { order: { token: A_METHOD, amount: UINT256_MAX, payee: A_METHOD } }, 3],
    ['maximum ids and window', { attemptId: UINT64_MAX, setupNonce: UINT64_MAX, validUntil: UINT48_MAX }, 1],
    ['zero ids and window', { attemptId: 0n, setupNonce: 0n, validUntil: 0 }, 0],
    ['largest place a number carries', {}, Number.MAX_SAFE_INTEGER],
    ['a long payload', { payload: repeat('c3', 97) }, 2],
    ['another chain', { chainId: 11_155_111 }, 5],
  ] as [string, Partial<Members>, number][])('boundary row: %s', (_label, overrides, place) => {
    const m = { ...baseMembers(), ...overrides };

    expect(approvalDigest(members(overrides), place)).toBe(oracleApproval(m, place));
    expect(cancellationDigest(members(overrides), place)).toBe(oracleCancellation(m, place));
  });

  it('an approval and a cancellation over the same members differ', () => {
    for (const place of [0, 1, 17]) {
      expect(approvalDigest(members(), place)).not.toBe(cancellationDigest(members(), place));
    }
  });

  it('one request yields one digest per place, differing in the place alone', () => {
    const digests = [0, 1, 2, 3].map((place) => approvalDigest(members(), place));

    expect(new Set(digests).size).toBe(4);
  });

  const CHANGES: [string, Partial<Members>, boolean][] = [
    ['chainId', { chainId: 2 }, true],
    ['manager', { manager: A_METHOD }, true],
    ['account', { account: A_METHOD }, true],
    ['action', { action: A_METHOD }, true],
    ['attemptId', { attemptId: 10n }, true],
    ['setupNonce', { setupNonce: 8n }, true],
    ['setupBodyHash', { setupBodyHash: repeat('00', 32) }, true],
    ['validUntil', { validUntil: 1_800_000_001 }, true],
    ['payload', { payload: '0xabcdee' }, false],
    ['order.token', { order: { ...baseMembers().order, token: A_METHOD } }, false],
    ['order.amount', { order: { ...baseMembers().order, amount: 1n } }, false],
    ['order.payee', { order: { ...baseMembers().order, payee: A_METHOD } }, false],
  ];

  it.each(CHANGES)('a change of %s changes the approval digest', (_member, overrides) => {
    expect(approvalDigest(members(overrides), 0)).not.toBe(approvalDigest(members(), 0));
  });

  it.each(CHANGES)('a change of %s changes the cancellation digest only if it is a member (%#)', (_member, overrides, inCancel) => {
    const changed = cancellationDigest(members(overrides), 0) !== cancellationDigest(members(), 0);

    expect(changed).toBe(inCancel);
  });

  it('the digest is the hash of the typed data it returns, so a wallet signs the same bytes', () => {
    expect(hashTypedData(approvalTypedData(members(), 4) as Parameters<typeof hashTypedData>[0])).toBe(
      approvalDigest(members(), 4),
    );
    expect(hashTypedData(cancellationTypedData(members(), 4) as Parameters<typeof hashTypedData>[0])).toBe(
      cancellationDigest(members(), 4),
    );
  });
});

describe('the typed data objects', () => {
  it('carry the domain from the chain id, the manager and DIGEST_VERSION alone', () => {
    const extra = { ...members(), name: 'Other', version: '99', salt: repeat('01', 32) } as ApprovalMembers;

    for (const typed of [approvalTypedData(extra, 0), cancellationTypedData(extra, 0)]) {
      expect(typed.domain).toStrictEqual({
        name: 'PolicyManager',
        version: DIGEST_VERSION,
        chainId: 1,
        verifyingContract: '0x6666666666666666666666666666666666666666',
      });
    }

    expect(DIGEST_VERSION).toBe('1');
    expect(approvalDigest(extra, 0)).toBe(approvalDigest(members(), 0));
  });

  it('Approval types: exact struct names, field order and types, PaymentOrder nested', () => {
    const typed = approvalTypedData(members(), 0);

    expect(typed.primaryType).toBe('Approval');
    expect(typed.types).toStrictEqual({
      Approval: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'address' },
        { name: 'attemptId', type: 'uint64' },
        { name: 'setupNonce', type: 'uint64' },
        { name: 'setupBodyHash', type: 'bytes32' },
        { name: 'payload', type: 'bytes' },
        { name: 'order', type: 'PaymentOrder' },
        { name: 'validUntil', type: 'uint48' },
        { name: 'place', type: 'uint256' },
      ],
      PaymentOrder: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'payee', type: 'address' },
      ],
    });
    expect(typed.message).toStrictEqual({
      account: baseMembers().account,
      action: baseMembers().action,
      attemptId: 9n,
      setupNonce: 7n,
      setupBodyHash: baseMembers().setupBodyHash,
      payload: '0xabcdef',
      order: baseMembers().order,
      validUntil: 1_800_000_000,
      place: 0,
    });
  });

  it('Cancellation types: no payload, no order, no PaymentOrder', () => {
    const typed = cancellationTypedData(members(), 2);

    expect(typed.primaryType).toBe('Cancellation');
    expect(typed.types).toStrictEqual({
      Cancellation: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'address' },
        { name: 'attemptId', type: 'uint64' },
        { name: 'setupNonce', type: 'uint64' },
        { name: 'setupBodyHash', type: 'bytes32' },
        { name: 'validUntil', type: 'uint48' },
        { name: 'place', type: 'uint256' },
      ],
    });
    expect(Object.keys(typed.message)).toStrictEqual([
      'account',
      'action',
      'attemptId',
      'setupNonce',
      'setupBodyHash',
      'validUntil',
      'place',
    ]);
  });

  it('a caller editing one returned types table reaches no later call', () => {
    const first = approvalTypedData(members(), 0);

    (first.types['Approval'] as { name: string; type: string }[]).length = 0;

    expect(approvalTypedData(members(), 0).types['Approval']).toHaveLength(9);
    expect(approvalDigest(members(), 0)).toBe(oracleApproval(baseMembers(), 0));
  });
});

describe('width refusals', () => {
  it.each([
    ['attemptId 2^64', { attemptId: UINT64_MAX + 1n }, RangeError],
    ['a negative attemptId', { attemptId: -1n }, RangeError],
    ['setupNonce 2^64', { setupNonce: UINT64_MAX + 1n }, RangeError],
    ['validUntil 2^48', { validUntil: 2 ** 48 }, RangeError],
    ['a negative validUntil', { validUntil: -1 }, RangeError],
    ['a fractional validUntil', { validUntil: 0.5 }, TypeError],
    ['a negative chainId', { chainId: -1 }, RangeError],
    ['a 31-byte setupBodyHash', { setupBodyHash: repeat('00', 31) }, TypeError],
    ['an odd-length setupBodyHash', { setupBodyHash: `${repeat('00', 32)}0` }, TypeError],
    ['a short manager', { manager: '0x6666' }, TypeError],
    ['a short account', { account: '0x1111' }, TypeError],
  ] as [string, Partial<Members>, ErrorConstructor][])('both builders refuse %s', (_label, overrides, error) => {
    expect(() => approvalDigest(members(overrides), 0)).toThrow(error);
    expect(() => cancellationDigest(members(overrides), 0)).toThrow(error);
    expect(() => approvalTypedData(members(overrides), 0)).toThrow(error);
    expect(() => cancellationTypedData(members(overrides), 0)).toThrow(error);
  });

  it.each([
    ['amount 2^256', { order: { ...baseMembers().order, amount: UINT256_MAX + 1n } }, RangeError],
    ['a negative amount', { order: { ...baseMembers().order, amount: -1n } }, RangeError],
    ['an odd-length payload', { payload: '0xabc' }, TypeError],
    ['a non-hex payload', { payload: '0xzz' }, TypeError],
    ['a short token', { order: { ...baseMembers().order, token: '0x44' } }, TypeError],
    ['a short payee', { order: { ...baseMembers().order, payee: '0x55' } }, TypeError],
  ] as [string, Partial<Members>, ErrorConstructor][])('the approval builders refuse %s', (_label, overrides, error) => {
    expect(() => approvalDigest(members(overrides), 0)).toThrow(error);
    expect(() => approvalTypedData(members(overrides), 0)).toThrow(error);
  });

  it.each([
    ['a negative place', -1, RangeError],
    ['a fractional place', 1.5, TypeError],
    ['a place past the safe-integer range', Number.MAX_SAFE_INTEGER + 1, RangeError],
    ['a NaN place', Number.NaN, TypeError],
  ])('both digests refuse %s', (_label, place, error) => {
    expect(() => approvalDigest(members(), place)).toThrow(error);
    expect(() => cancellationDigest(members(), place)).toThrow(error);
  });
});
