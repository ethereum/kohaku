import { getAddress, hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  credentialHash,
  encodeSetupBody,
  FORMATS_APPROVAL_TYPED_DATA_TYPES,
  FORMATS_CANCELLATION_TYPED_DATA_TYPES,
  setupCommitment,
  type Address,
  type ApprovalMembers,
  type SetupBody,
} from '../../src/index';
import { A_ACCOUNT, baseMembers, oracleApproval, oracleCancellation, repeat } from './support';

const LOWER: Address = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const UPPER: Address = '0x8BA1F109551BD432803012645AC136DDD64DBA72';
const CHECKSUMMED: Address = getAddress(LOWER);
/** One letter's case flipped from the EIP-55 spelling, so the checksum fails. */
const BAD_CHECKSUM: Address = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';
const SALT = repeat('aa', 32);
const ADDRESS_REFUSAL = /must be a 20-byte address$/;
const ENGINE_REFUSAL = /Cannot read properties/;

const withEveryAddress = (address: Address): ApprovalMembers => ({
  ...baseMembers(),
  manager: address,
  account: address,
  action: address,
  order: { ...baseMembers().order, token: address, payee: address },
});

describe('address spelling', () => {
  it('the three accepted spellings name one address', () => {
    expect(CHECKSUMMED).toBe('0x8ba1f109551bD432803012645Ac136ddd64DBA72');
    expect(UPPER.toLowerCase()).toBe(LOWER);
    expect(BAD_CHECKSUM.toLowerCase()).toBe(LOWER);
    expect(BAD_CHECKSUM).not.toBe(CHECKSUMMED);
  });

  it.each([
    ['all lowercase', LOWER],
    ['all uppercase', UPPER],
    ['EIP-55 mixed case', CHECKSUMMED],
  ])('accepts an %s address and derives what the lowercase spelling derives', (_label, address) => {
    expect(credentialHash(address, '0x01', SALT)).toBe(credentialHash(LOWER, '0x01', SALT));
    expect(setupCommitment(address, address, 1n, '0x')).toBe(setupCommitment(LOWER, LOWER, 1n, '0x'));
    expect(approvalDigest(withEveryAddress(address), 3)).toBe(oracleApproval(withEveryAddress(LOWER), 3));
    expect(cancellationDigest(withEveryAddress(address), 3)).toBe(oracleCancellation(withEveryAddress(LOWER), 3));
  });

  it.each([
    ['all lowercase', LOWER],
    ['all uppercase', UPPER],
    ['EIP-55 mixed case', CHECKSUMMED],
  ])('returns typed data with the checksummed spelling of an %s address, which hashTypedData accepts', (_label, address) => {
    const typed = approvalTypedData(withEveryAddress(address), 3);
    const cancel = cancellationTypedData(withEveryAddress(address), 3);

    expect(typed.domain.verifyingContract).toBe(CHECKSUMMED);
    expect(typed.message.account).toBe(CHECKSUMMED);
    expect(typed.message.action).toBe(CHECKSUMMED);
    expect(typed.message.order.token).toBe(CHECKSUMMED);
    expect(typed.message.order.payee).toBe(CHECKSUMMED);
    expect(cancel.domain.verifyingContract).toBe(CHECKSUMMED);
    expect(cancel.message.account).toBe(CHECKSUMMED);
    expect(cancel.message.action).toBe(CHECKSUMMED);
    expect(hashTypedData(typed as Parameters<typeof hashTypedData>[0])).toBe(approvalDigest(withEveryAddress(address), 3));
    expect(hashTypedData(cancel as Parameters<typeof hashTypedData>[0])).toBe(cancellationDigest(withEveryAddress(address), 3));
  });

  it('returns a checksummed input byte-identical', () => {
    const typed = approvalTypedData(withEveryAddress(CHECKSUMMED), 0);

    expect([typed.domain.verifyingContract, typed.message.account, typed.message.order.payee]).toStrictEqual([
      '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
      '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
      '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    ]);
  });

  it.each([
    ['a mixed-case address whose checksum fails', BAD_CHECKSUM],
    ['39 hex digits', LOWER.slice(0, -1)],
    ['41 hex digits', `${LOWER}a`],
    ['an uppercase 0X prefix', `0X${LOWER.slice(2)}`],
    ['no prefix', LOWER.slice(2)],
    ['a non-hex digit', `${LOWER.slice(0, -1)}g`],
    ['a number', 0x1234],
    ['a bigint', 0x1234n],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s with a named TypeError from every builder', (_label, value) => {
    const address = value as Address;

    expect(() => credentialHash(address, '0x01', SALT)).toThrow(new TypeError('method must be a 20-byte address'));
    expect(() => setupCommitment(A_ACCOUNT, address, 1n, '0x')).toThrow(new TypeError('action must be a 20-byte address'));
    expect(() => approvalDigest({ ...baseMembers(), manager: address }, 0)).toThrow(
      new TypeError('manager must be a 20-byte address'),
    );
    expect(() => approvalTypedData({ ...baseMembers(), order: { ...baseMembers().order, payee: address } }, 0)).toThrow(
      new TypeError('order.payee must be a 20-byte address'),
    );
    expect(() => cancellationDigest({ ...baseMembers(), account: address }, 0)).toThrow(ADDRESS_REFUSAL);
  });
});

describe('missing objects', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('encodeSetupBody refuses a %s body by name', (_label, body) => {
    const encode = (): unknown => encodeSetupBody(body as unknown as SetupBody);

    expect(encode).toThrow(new TypeError('body must be an object'));
    expect(encode).not.toThrow(ENGINE_REFUSAL);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('the approval builders refuse a %s order by name', (_label, order) => {
    const members = { ...baseMembers(), order } as unknown as ApprovalMembers;

    for (const build of [() => approvalTypedData(members, 0), () => approvalDigest(members, 0)]) {
      expect(build).toThrow(TypeError);
      expect(build).toThrow(new TypeError('order must be an object'));
      expect(build).not.toThrow(ENGINE_REFUSAL);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('every digest builder refuses %s members by name', (_label, members) => {
    const given = members as unknown as ApprovalMembers;

    for (const build of [
      () => approvalTypedData(given, 0),
      () => approvalDigest(given, 0),
      () => cancellationTypedData(given, 0),
      () => cancellationDigest(given, 0),
    ]) {
      expect(build).toThrow(TypeError);
      expect(build).toThrow(new TypeError('members must be an object'));
      expect(build).not.toThrow(ENGINE_REFUSAL);
    }
  });
  it.each([
    ['token', 'order.token'],
    ['payee', 'order.payee'],
  ])('the approval builders refuse an order without its %s by name', (member, name) => {
    const order: Record<string, unknown> = { ...baseMembers().order };

    delete order[member];

    const members = { ...baseMembers(), order } as unknown as ApprovalMembers;

    for (const build of [() => approvalTypedData(members, 0), () => approvalDigest(members, 0)]) {
      expect(build).toThrow(new TypeError(`${name} must be a 20-byte address`));
    }
  });
});

describe('the returned types table', () => {
  it('is a fresh copy on every call, never the exported constant', () => {
    const [first, second] = [approvalTypedData(baseMembers(), 0), approvalTypedData(baseMembers(), 0)];
    const [third, fourth] = [cancellationTypedData(baseMembers(), 0), cancellationTypedData(baseMembers(), 0)];

    expect(first.types).not.toBe(second.types);
    expect(first.types['Approval']).not.toBe(second.types['Approval']);
    expect(first.types['Approval']?.[0]).not.toBe(second.types['Approval']?.[0]);
    expect(first.types).not.toBe(FORMATS_APPROVAL_TYPED_DATA_TYPES);
    expect(third.types).not.toBe(fourth.types);
    expect(third.types).not.toBe(FORMATS_CANCELLATION_TYPED_DATA_TYPES);
    expect(first.types).toStrictEqual(FORMATS_APPROVAL_TYPED_DATA_TYPES);
    expect(third.types).toStrictEqual(FORMATS_CANCELLATION_TYPED_DATA_TYPES);
  });

  it('a caller editing a cancellation types table reaches no later call or digest', () => {
    const first = cancellationTypedData(baseMembers(), 0);
    const field = first.types['Cancellation']?.[0] as { name: string; type: string };

    field.type = 'uint8';
    (first.types['Cancellation'] as unknown[]).length = 1;

    expect(cancellationTypedData(baseMembers(), 0).types['Cancellation']).toHaveLength(7);
    expect(cancellationTypedData(baseMembers(), 0).types['Cancellation']?.[0]).toStrictEqual({ name: 'account', type: 'address' });
    expect(cancellationDigest(baseMembers(), 0)).toBe(oracleCancellation(baseMembers(), 0));
  });
});
