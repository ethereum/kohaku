import { hashTypedData } from 'viem';
import {
  FORMATS_APPROVAL_PRIMARY_TYPE,
  FORMATS_APPROVAL_TYPED_DATA_TYPES,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCELLATION_PRIMARY_TYPE,
  FORMATS_CANCELLATION_TYPED_DATA_TYPES,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_DECIMAL_PATTERN,
  FORMATS_DIGEST_DOMAIN_NAME,
  DIGEST_VERSION,
  FORMATS_PLACE_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
} from '../constants';
import type { ApprovalMessage, CancellationMessage, Hex, TypedData, TypedDataDomain } from '../interfaces';
import type { ApprovalMembers, ApprovalTypedData, CancellationMembers, CancellationTypedData } from '../types';
import { assertBytes, assertBytes32, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from './guards';
import { checkedPaymentOrder } from './payment-order';

/** A fresh copy of a types table, so a caller editing one typed data object reaches no other. */
function copyTypes(types: TypedData['types']): TypedData['types'] {
  return Object.fromEntries(
    Object.entries(types).map(([struct, fields]) => [struct, fields.map((field) => ({ ...field }))]),
  );
}

/** The EIP-712 domain both digests are signed under, its manager address checksummed. */
function domainOf(members: CancellationMembers): TypedDataDomain {
  assertObject(members, 'members');
  assertUintNumber(members.chainId, FORMATS_CHAIN_ID_BITS, 'chainId');

  const manager = normalizeAddress(members.manager, 'manager');

  if (members.digestVersion !== undefined && (typeof members.digestVersion !== 'string' || !FORMATS_DECIMAL_PATTERN.test(members.digestVersion))) {
    throw new TypeError('digestVersion must be a non-empty decimal string');
  }

  return { name: FORMATS_DIGEST_DOMAIN_NAME, version: members.digestVersion ?? DIGEST_VERSION, chainId: members.chainId, verifyingContract: manager };
}

/** The members both messages share, each checked against its width, addresses checksummed. */
function cancellationMessageOf(members: CancellationMembers, place: number | bigint): CancellationMessage {
  const account = normalizeAddress(members.account, 'account');
  const action = normalizeAddress(members.action, 'action');

  assertUintBigint(members.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  assertUintBigint(members.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  assertBytes32(members.setupBodyHash, 'setupBodyHash');
  assertUintNumber(members.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');

  if (typeof place === 'bigint') assertUintBigint(place, FORMATS_PLACE_BITS, 'place');
  else assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return {
    account,
    action,
    attemptId: members.attemptId,
    setupNonce: members.setupNonce,
    setupBodyHash: members.setupBodyHash,
    validUntil: members.validUntil,
    place: BigInt(place),
  };
}

/** The checked domain and `Approval` message for one place, shared by the typed data and the digest. */
function approvalParts(members: ApprovalMembers, place: number | bigint): { domain: TypedDataDomain; message: ApprovalMessage } {
  const domain = domainOf(members);
  const shared = cancellationMessageOf(members, place);

  assertBytes(members.payload, 'payload');

  return { domain, message: { ...shared, payload: members.payload, order: checkedPaymentOrder(members.order, 'order') } };
}

/** The checked domain and `Cancellation` message for one place, shared by the typed data and the digest. */
function cancellationParts(members: CancellationMembers, place: number | bigint): { domain: TypedDataDomain; message: CancellationMessage } {
  return { domain: domainOf(members), message: cancellationMessageOf(members, place) };
}

/**
 * The `Approval` typed data for one place, as a wallet's signing call takes it; throws on a member outside its width. The place is a non-negative safe integer as a number, or a `uint256` as a bigint.
 * The types omit `EIP712Domain`: a signing library supplies it from the domain, and a raw `eth_signTypedData_v4` caller adds it from the domain's four fields.
 */
export function approvalTypedData(members: ApprovalMembers, place: number | bigint): ApprovalTypedData {
  const { domain, message } = approvalParts(members, place);

  return { domain, types: copyTypes(FORMATS_APPROVAL_TYPED_DATA_TYPES), primaryType: FORMATS_APPROVAL_PRIMARY_TYPE, message };
}

/**
 * The `Cancellation` typed data for one place; throws on a member outside its width. The place is a non-negative safe integer as a number, or a `uint256` as a bigint.
 * The types omit `EIP712Domain`: a signing library supplies it from the domain, and a raw `eth_signTypedData_v4` caller adds it from the domain's four fields.
 */
export function cancellationTypedData(members: CancellationMembers, place: number | bigint): CancellationTypedData {
  const { domain, message } = cancellationParts(members, place);

  return { domain, types: copyTypes(FORMATS_CANCELLATION_TYPED_DATA_TYPES), primaryType: FORMATS_CANCELLATION_PRIMARY_TYPE, message };
}

/** The EIP-712 digest of typed data already built and checked. */
export function typedDataDigest(typedData: ApprovalTypedData | CancellationTypedData): Hex {
  const { domain, types, primaryType, message } = typedData;

  return hashTypedData({ domain, types, primaryType, message });
}

/** The EIP-712 digest of the `Approval` message for one place: a non-negative safe integer as a number, or a `uint256` as a bigint. */
export function approvalDigest(members: ApprovalMembers, place: number | bigint): Hex {
  const { domain, message } = approvalParts(members, place);

  return typedDataDigest({ domain, types: FORMATS_APPROVAL_TYPED_DATA_TYPES, primaryType: FORMATS_APPROVAL_PRIMARY_TYPE, message });
}

/** The EIP-712 digest of the `Cancellation` message for one place: a non-negative safe integer as a number, or a `uint256` as a bigint. */
export function cancellationDigest(members: CancellationMembers, place: number | bigint): Hex {
  const { domain, message } = cancellationParts(members, place);

  return typedDataDigest({ domain, types: FORMATS_CANCELLATION_TYPED_DATA_TYPES, primaryType: FORMATS_CANCELLATION_PRIMARY_TYPE, message });
}
