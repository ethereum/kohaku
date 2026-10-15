import { getAddress, hashTypedData } from 'viem';
import type { ApproverRequest, Hex } from '../../src/index';

const PAYMENT_ORDER = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payee', type: 'address' },
] as const;

const SHARED_HEAD = [
  { name: 'account', type: 'address' },
  { name: 'action', type: 'address' },
  { name: 'attemptId', type: 'uint64' },
  { name: 'setupNonce', type: 'uint64' },
  { name: 'setupBodyHash', type: 'bytes32' },
] as const;

const SHARED_TAIL = [
  { name: 'validUntil', type: 'uint48' },
  { name: 'place', type: 'uint256' },
] as const;

/** The manager's `Approval` struct, written out from the contracts' type string. */
export const APPROVAL_TYPES = {
  Approval: [...SHARED_HEAD, { name: 'payload', type: 'bytes' }, { name: 'order', type: 'PaymentOrder' }, ...SHARED_TAIL],
  PaymentOrder: PAYMENT_ORDER,
} as const;

/** The manager's `Cancellation` struct, written out from the contracts' type string. */
export const CANCELLATION_TYPES = { Cancellation: [...SHARED_HEAD, ...SHARED_TAIL] } as const;

/** The domain a request names: the manager's name, the request's own version, chain id and manager. */
export const domainOf = (request: ApproverRequest) => ({
  name: 'PolicyManager',
  version: BigInt(request.digestVersion).toString(),
  chainId: Number(request.chainId),
  verifyingContract: getAddress(request.manager),
});

/** The digest a request's place must carry, by viem over hand-written types and the request's members. */
export function expectedDigest(request: ApproverRequest, place: number = request.place): Hex {
  const domain = domainOf(request);
  const common = {
    account: getAddress(request.account),
    action: getAddress(request.action),
    attemptId: BigInt(request.attemptId),
    setupNonce: BigInt(request.setupNonce),
    setupBodyHash: request.setupBodyHash,
    validUntil: Number(request.validUntil),
    place: BigInt(place),
  };

  if (request.purpose === 'approval') {
    const order = { token: getAddress(request.order.token), amount: BigInt(request.order.amount), payee: getAddress(request.order.payee) };

    return hashTypedData({ domain, types: APPROVAL_TYPES, primaryType: 'Approval', message: { ...common, payload: request.payload, order } });
  }

  return hashTypedData({ domain, types: CANCELLATION_TYPES, primaryType: 'Cancellation', message: common });
}

/** The digest viem computes over a typed data record as the orchestrator handed it, `EIP712Domain` supplied by viem. */
export const hashOf = (typedData: unknown): Hex => hashTypedData(typedData as Parameters<typeof hashTypedData>[0]);

/** The request's members as the merged digest builders take them. */
export const membersOf = (request: ApproverRequest) => {
  const shared = {
    chainId: Number(request.chainId),
    manager: request.manager,
    digestVersion: request.digestVersion,
    account: request.account,
    action: request.action,
    attemptId: BigInt(request.attemptId),
    setupNonce: BigInt(request.setupNonce),
    setupBodyHash: request.setupBodyHash,
    validUntil: Number(request.validUntil),
  };

  return request.purpose === 'approval'
    ? {
        ...shared,
        payload: request.payload,
        order: { token: request.order.token, amount: BigInt(request.order.amount), payee: request.order.payee },
      }
    : shared;
};
