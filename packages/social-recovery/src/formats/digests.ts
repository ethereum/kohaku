import { hashTypedData } from 'viem';
import {
  FORMATS_AMOUNT_BITS,
  FORMATS_APPROVAL_PRIMARY_TYPE,
  FORMATS_APPROVAL_TYPED_DATA_TYPES,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCELLATION_PRIMARY_TYPE,
  FORMATS_CANCELLATION_TYPED_DATA_TYPES,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_DIGEST_DOMAIN_NAME,
  DIGEST_VERSION,
  FORMATS_PLACE_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
} from '../constants';
import type { ApprovalMessage, CancellationMessage, Hex, TypedData, TypedDataDomain } from '../interfaces';
import type { ApprovalMembers, ApprovalTypedData, CancellationMembers, CancellationTypedData } from '../types';
import { assertAddress, assertBytes, assertBytes32, assertUintBigint, assertUintNumber } from './guards';

/** A fresh copy of a types table, so a caller editing one typed data object reaches no other. */
function copyTypes(types: TypedData['types']): TypedData['types'] {
  return Object.fromEntries(
    Object.entries(types).map(([struct, fields]) => [struct, fields.map((field) => ({ ...field }))]),
  );
}

/** The EIP-712 domain both digests are signed under. */
function domainOf(members: CancellationMembers): TypedDataDomain {
  assertUintNumber(members.chainId, FORMATS_CHAIN_ID_BITS, 'chainId');
  assertAddress(members.manager, 'manager');

  return { name: FORMATS_DIGEST_DOMAIN_NAME, version: DIGEST_VERSION, chainId: members.chainId, verifyingContract: members.manager };
}

/** The members both messages share, each checked against its width. */
function cancellationMessageOf(members: CancellationMembers, place: number): CancellationMessage {
  assertAddress(members.account, 'account');
  assertAddress(members.action, 'action');
  assertUintBigint(members.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  assertUintBigint(members.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  assertBytes32(members.setupBodyHash, 'setupBodyHash');
  assertUintNumber(members.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');
  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return {
    account: members.account,
    action: members.action,
    attemptId: members.attemptId,
    setupNonce: members.setupNonce,
    setupBodyHash: members.setupBodyHash,
    validUntil: members.validUntil,
    place,
  };
}

/** The `Approval` typed data for one place, as a wallet's signing call takes it; throws on a member outside its width. */
export function approvalTypedData(members: ApprovalMembers, place: number): ApprovalTypedData {
  const domain = domainOf(members);
  const shared = cancellationMessageOf(members, place);

  assertBytes(members.payload, 'payload');
  assertAddress(members.order.token, 'order.token');
  assertUintBigint(members.order.amount, FORMATS_AMOUNT_BITS, 'order.amount');
  assertAddress(members.order.payee, 'order.payee');

  const message: ApprovalMessage = {
    account: shared.account,
    action: shared.action,
    attemptId: shared.attemptId,
    setupNonce: shared.setupNonce,
    setupBodyHash: shared.setupBodyHash,
    payload: members.payload,
    order: { token: members.order.token, amount: members.order.amount, payee: members.order.payee },
    validUntil: shared.validUntil,
    place: shared.place,
  };

  return { domain, types: copyTypes(FORMATS_APPROVAL_TYPED_DATA_TYPES), primaryType: FORMATS_APPROVAL_PRIMARY_TYPE, message };
}

/** The `Cancellation` typed data for one place; throws on a member outside its width. */
export function cancellationTypedData(members: CancellationMembers, place: number): CancellationTypedData {
  const domain = domainOf(members);
  const message = cancellationMessageOf(members, place);

  return { domain, types: copyTypes(FORMATS_CANCELLATION_TYPED_DATA_TYPES), primaryType: FORMATS_CANCELLATION_PRIMARY_TYPE, message };
}

/** The EIP-712 digest of the `Approval` message for one place. */
export function approvalDigest(members: ApprovalMembers, place: number): Hex {
  const { domain, message } = approvalTypedData(members, place);

  return hashTypedData({
    domain,
    types: FORMATS_APPROVAL_TYPED_DATA_TYPES,
    primaryType: FORMATS_APPROVAL_PRIMARY_TYPE,
    message: { ...message, place: BigInt(message.place) },
  });
}

/** The EIP-712 digest of the `Cancellation` message for one place. */
export function cancellationDigest(members: CancellationMembers, place: number): Hex {
  const { domain, message } = cancellationTypedData(members, place);

  return hashTypedData({
    domain,
    types: FORMATS_CANCELLATION_TYPED_DATA_TYPES,
    primaryType: FORMATS_CANCELLATION_PRIMARY_TYPE,
    message: { ...message, place: BigInt(message.place) },
  });
}
