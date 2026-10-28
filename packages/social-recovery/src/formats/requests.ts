import { decodeFunctionData, encodeFunctionData } from 'viem';
import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCEL_BY_PROOFS_ABI,
  FORMATS_CANCEL_BY_PROOFS_SELECTOR,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_START_ATTEMPT_ABI,
  FORMATS_START_ATTEMPT_SELECTOR,
  FORMATS_VALID_UNTIL_BITS,
} from '../constants';
import type { AttemptRequest, CancelRequest, Hex } from '../interfaces';
import { assertBytes, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from './guards';
import { checkedPaymentOrder } from './payment-order';
import { fromAbiProofPlaces, sortedProofPlaces, toAbiProofPlace } from './proof-place';
import { decodeStrictly } from './strict';

/** A checked copy of a cancel request, whose members an attempt request shares, addresses checksummed and proofs sorted by place. */
function checkedCancelRequest(request: CancelRequest): CancelRequest {
  assertObject(request, 'request');

  const account = normalizeAddress(request.account, 'account');
  const action = normalizeAddress(request.action, 'action');

  assertUintBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  assertUintBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  assertBytes(request.setupBody, 'setupBody');
  assertUintNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');

  return {
    account,
    action,
    attemptId: request.attemptId,
    setupNonce: request.setupNonce,
    setupBody: request.setupBody,
    validUntil: request.validUntil,
    proofs: sortedProofPlaces(request.proofs),
  };
}

/** A checked copy of an attempt request, addresses checksummed and proofs sorted by place. */
function checkedAttemptRequest(request: AttemptRequest): AttemptRequest {
  const shared = checkedCancelRequest(request);

  assertBytes(request.payload, 'payload');

  return { ...shared, payload: request.payload, order: checkedPaymentOrder(request.order, 'order') };
}

/** The calldata lower-cased, since the function lookup compares selectors case-sensitively; a wrong selector throws a `RangeError`. */
function lowerCaseCall(calldata: Hex, selector: Hex, functionName: string): Hex {
  assertBytes(calldata, 'calldata');

  const lowered = calldata.toLowerCase() as Hex;

  if (lowered.slice(0, selector.length) !== selector) {
    throw new RangeError(`calldata does not open with the ${functionName} selector ${selector}`);
  }

  return lowered;
}

/**
 * Encodes `startAttempt(request)` calldata, throwing on a member outside its width.
 * Proofs are encoded sorted by place, a repeated place throws a `RangeError`, and an empty proof array is accepted.
 */
export function encodeAttemptRequest(request: AttemptRequest): Hex {
  const checked = checkedAttemptRequest(request);

  return encodeFunctionData({
    abi: FORMATS_START_ATTEMPT_ABI,
    functionName: 'startAttempt',
    args: [{ ...checked, proofs: checked.proofs.map(toAbiProofPlace) }],
  });
}

/**
 * Encodes `cancelByProofs(request)` calldata, throwing on a member outside its width.
 * Proofs are encoded sorted by place, a repeated place throws a `RangeError`, and an empty proof array is accepted.
 */
export function encodeCancelRequest(request: CancelRequest): Hex {
  const checked = checkedCancelRequest(request);

  return encodeFunctionData({
    abi: FORMATS_CANCEL_BY_PROOFS_ABI,
    functionName: 'cancelByProofs',
    args: [{ ...checked, proofs: checked.proofs.map(toAbiProofPlace) }],
  });
}

/**
 * Decodes `startAttempt` calldata, refusing a wrong selector, trailing or non-canonical bytes,
 * and proofs whose places are not strictly increasing, so a decoded request re-encodes to its input.
 */
export function decodeAttemptRequest(calldata: Hex): AttemptRequest {
  const lowered = lowerCaseCall(calldata, FORMATS_START_ATTEMPT_SELECTOR, 'startAttempt');

  return decodeStrictly(lowered, 'calldata', 'startAttempt(AttemptRequest)', {
    decode: (bytes) => decodeFunctionData({ abi: FORMATS_START_ATTEMPT_ABI, data: bytes }).args[0],
    build: (raw) => checkedAttemptRequest({ ...raw, proofs: fromAbiProofPlaces(raw.proofs) }),
    encode: encodeAttemptRequest,
  });
}

/**
 * Decodes `cancelByProofs` calldata, refusing a wrong selector, trailing or non-canonical bytes,
 * and proofs whose places are not strictly increasing, so a decoded request re-encodes to its input.
 */
export function decodeCancelRequest(calldata: Hex): CancelRequest {
  const lowered = lowerCaseCall(calldata, FORMATS_CANCEL_BY_PROOFS_SELECTOR, 'cancelByProofs');

  return decodeStrictly(lowered, 'calldata', 'cancelByProofs(CancelRequest)', {
    decode: (bytes) => decodeFunctionData({ abi: FORMATS_CANCEL_BY_PROOFS_ABI, data: bytes }).args[0],
    build: (raw) => checkedCancelRequest({ ...raw, proofs: fromAbiProofPlaces(raw.proofs) }),
    encode: encodeCancelRequest,
  });
}
