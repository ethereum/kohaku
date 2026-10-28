import { keccak256 } from 'viem';
import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  FORMATS_ZERO_ADDRESS,
  RECOVERY_CLIENT_ATTEMPT_DIFFERS_MESSAGE,
  RECOVERY_CLIENT_OPEN_PAYEE_MESSAGE,
  RECOVERY_CLIENT_PAYLOAD_HASH_MESSAGE,
  RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE,
  RECOVERY_CLIENT_SPEND_VETOED_MESSAGE,
} from '../constants';
import { KitRefusalError } from '../client-core';
import {
  assertBool,
  assertBytes32,
  assertObject,
  assertUintBigint,
  assertUintNumber,
  lowerHex,
  normalizeAddress,
  normalizeAddresses,
  sameAddress,
} from '../formats/guards';
import { checkedPaymentOrder } from '../formats/payment-order';
import { ATTEMPT_STATES, type Address, type Attempt, type Handover, type Hex, type PinnedBlock, type PrepareOptions } from '../interfaces';
import type { RecoveryClientParts } from '../types/recovery-client';
import { pausedAt } from './standings';

/** A checked copy of the attempt, its addresses checksummed and its payload hash lower-cased, refusing a malformed member. */
export function checkedAttempt(attempt: Attempt): Attempt {
  assertObject(attempt, 'attempt');
  assertUintBigint(attempt.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attempt.attemptId');
  assertUintBigint(attempt.setupNonce, FORMATS_SETUP_NONCE_BITS, 'attempt.setupNonce');
  assertUintNumber(attempt.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'attempt.consumableAfter');

  if (!ATTEMPT_STATES.includes(attempt.state)) throw new TypeError(`attempt.state must be one of ${ATTEMPT_STATES.join(', ')}`);

  assertBytes32(attempt.payloadHash, 'attempt.payloadHash');
  assertBool(attempt.ignoresPause, 'attempt.ignoresPause');

  const order = checkedPaymentOrder(attempt.order, 'attempt.order');
  const usedMethods = normalizeAddresses(attempt.usedMethods, 'attempt.usedMethods');

  return {
    attemptId: attempt.attemptId,
    setupNonce: attempt.setupNonce,
    consumableAfter: attempt.consumableAfter,
    state: attempt.state,
    payloadHash: lowerHex(attempt.payloadHash),
    order,
    usedMethods,
    ignoresPause: attempt.ignoresPause,
  };
}

/** The address the payment leg pays: the order's payee, or the sender named by `options.from` where the order leaves it open. */
export function payeeOf(attempt: Attempt, options: PrepareOptions | undefined): Address | undefined {
  const { order } = attempt;

  if (!sameAddress(order.payee, FORMATS_ZERO_ADDRESS)) return order.payee;

  if (options?.from !== undefined) return normalizeAddress(options.from, 'options.from');

  if (order.amount !== 0n) throw new TypeError(RECOVERY_CLIENT_OPEN_PAYEE_MESSAGE);

  return undefined;
}

/**
 * The two keys the payload hands over, refusing with a `KitRefusalError` carrying one `handover.malformed` finding a payload
 * the codec does not decode, one naming the zero address on either side, and one naming the same address on both.
 */
export function decodedHandover(parts: RecoveryClientParts, payload: Hex): Required<Handover> {
  let handover: Handover | undefined;

  try {
    handover = parts.codec.decode(payload);
  } catch {
    handover = undefined;
  }

  const newAuthority = handover?.newAuthority;
  const removedAuthority = handover?.removedAuthority;
  const zeroNew = newAuthority !== undefined && sameAddress(newAuthority, FORMATS_ZERO_ADDRESS);
  const zeroRemoved = removedAuthority !== undefined && sameAddress(removedAuthority, FORMATS_ZERO_ADDRESS);
  const sameAuthority = newAuthority !== undefined && removedAuthority !== undefined && sameAddress(newAuthority, removedAuthority);

  if (newAuthority === undefined || removedAuthority === undefined || zeroNew || zeroRemoved || sameAuthority) {
    const layoutDecodes = handover !== undefined;

    throw new KitRefusalError(RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE, {
      findings: {
        errors: [{ code: 'handover.malformed', subject: 'request', values: { zeroNew, zeroRemoved, layoutDecodes, sameAuthority } }],
        warnings: [],
      },
    });
  }

  const added = normalizeAddress(newAuthority, 'handover.newAuthority');
  const removed = normalizeAddress(removedAuthority, 'handover.removedAuthority');

  return { newAuthority: added, removedAuthority: removed };
}

/** Refuses with a `KitRefusalError` a payload whose hash is not the attempt's committed payload hash. */
export function assertPayloadHash(attempt: Attempt, payloadHash: Hex): void {
  if (lowerHex(payloadHash) !== attempt.payloadHash) throw new KitRefusalError(RECOVERY_CLIENT_PAYLOAD_HASH_MESSAGE);
}

/** The lower-cased payload's hash. */
export const payloadHashOf = (payload: Hex): Hex => keccak256(lowerHex(payload));

/** Refuses with a `KitRefusalError` an attempt whose id, payload hash or order is not the manager's checked one. */
export function assertSameAttempt(given: Attempt, held: Attempt): void {
  const { order } = held;
  const sameOrder =
    sameAddress(order.token, given.order.token) && order.amount === given.order.amount && sameAddress(order.payee, given.order.payee);

  if (held.attemptId === given.attemptId && held.payloadHash === given.payloadHash && sameOrder) return;

  throw new KitRefusalError(RECOVERY_CLIENT_ATTEMPT_DIFFERS_MESSAGE);
}

/**
 * Refuses with a `KitRefusalError` naming the method where a method the manager's checked attempt used is stopped, unless the
 * attempt ignores stops; each distinct method is read once at the block, the methods in parallel, and an unanswered read rejects with an `Error`.
 */
export async function assertSpendNotVetoed(parts: RecoveryClientParts, held: Attempt, block: PinnedBlock): Promise<void> {
  if (held.ignoresPause) return;

  const methods = [...new Set(held.usedMethods)];
  const stopped = await Promise.all(methods.map((method) => pausedAt(parts, method, block)));
  const vetoing = methods.find((_, index) => stopped[index] === true);

  if (vetoing !== undefined) throw new KitRefusalError(`${RECOVERY_CLIENT_SPEND_VETOED_MESSAGE}: ${vetoing}`);
}
