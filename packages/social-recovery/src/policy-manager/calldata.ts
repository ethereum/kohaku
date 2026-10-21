import { decodeFunctionData, encodeFunctionData } from 'viem';
import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCEL_BY_PROOFS_ABI,
  FORMATS_PLACE_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_START_ATTEMPT_ABI,
  POLICY_MANAGER_HASH_APPROVAL_ABI,
  POLICY_MANAGER_HASH_CANCEL_ABI,
  POLICY_MANAGER_WRITES_ABI,
} from '../constants';
import { encodeAttemptRequest, encodeCancelRequest } from '../formats';
import {
  assertBytes,
  assertBytes32,
  assertObject,
  assertUintBigint,
  assertUintNumber,
  lowerHex,
  normalizeAddress,
} from '../formats/guards';
import type { Address, AttemptRequest, CancelRequest, Hex } from '../interfaces';

/** The address in its checksummed spelling; a `TypeError` naming the argument where it is not the address the part is bound to. */
export function boundAddress(value: unknown, bound: Address, name: string, role: string): Address {
  const normalized = normalizeAddress(value, name);

  if (normalized !== bound) throw new TypeError(`${name} ${normalized} is not the bound ${role} ${bound}`);

  return normalized;
}

/** Refuses a request whose account or action is not the bound pair. */
export function assertBoundRequest(request: CancelRequest, account: Address, action: Address): void {
  assertObject(request, 'request');
  boundAddress(request.account, account, 'request.account', 'account');
  boundAddress(request.action, action, 'request.action', 'action');
}

/** `commitSetup(action, setupCommitment, nonce, publicMetadata, privateMetadata)` calldata, every hex argument lower-cased. */
export function commitSetupData(action: Address, setupCommitment: Hex, nonce: bigint, publicMetadata: Hex, privateMetadata: Hex): Hex {
  assertBytes32(setupCommitment, 'setupCommitment');
  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'nonce');
  assertBytes(publicMetadata, 'publicMetadata');
  assertBytes(privateMetadata, 'privateMetadata');

  return encodeFunctionData({
    abi: POLICY_MANAGER_WRITES_ABI,
    functionName: 'commitSetup',
    args: [action, lowerHex(setupCommitment), nonce, lowerHex(publicMetadata), lowerHex(privateMetadata)],
  });
}

/** `clearSetup(action, nonce)` calldata. */
export function clearSetupData(action: Address, nonce: bigint): Hex {
  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'nonce');

  return encodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, functionName: 'clearSetup', args: [action, nonce] });
}

/** `cancelByOwner(action, attemptId)` calldata. */
export function cancelByOwnerData(action: Address, attemptId: bigint): Hex {
  assertUintBigint(attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');

  return encodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, functionName: 'cancelByOwner', args: [action, attemptId] });
}

/** `cancelByVeto(account, action, attemptId, method)` calldata. */
export function cancelByVetoData(account: Address, action: Address, attemptId: bigint, method: unknown): Hex {
  assertUintBigint(attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');

  return encodeFunctionData({
    abi: POLICY_MANAGER_WRITES_ABI,
    functionName: 'cancelByVeto',
    args: [account, action, attemptId, normalizeAddress(method, 'method')],
  });
}

/** `hashApproval(request, place)` calldata with an empty proof array, every other member checked by the `startAttempt` codec. */
export function hashApprovalData(request: AttemptRequest, place: number): Hex {
  assertObject(request, 'request');

  const { args } = decodeFunctionData({ abi: FORMATS_START_ATTEMPT_ABI, data: encodeAttemptRequest({ ...request, proofs: [] }) });

  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return encodeFunctionData({ abi: POLICY_MANAGER_HASH_APPROVAL_ABI, args: [args[0], BigInt(place)] });
}

/** `hashCancel(request, place)` calldata with an empty proof array, every other member checked by the `cancelByProofs` codec. */
export function hashCancelData(request: CancelRequest, place: number): Hex {
  assertObject(request, 'request');

  const { args } = decodeFunctionData({ abi: FORMATS_CANCEL_BY_PROOFS_ABI, data: encodeCancelRequest({ ...request, proofs: [] }) });

  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return encodeFunctionData({ abi: POLICY_MANAGER_HASH_CANCEL_ABI, args: [args[0], BigInt(place)] });
}
