import {
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  GATHERING_RULE_UNSATISFIED_MESSAGE,
  GATHERING_WINDOW_PASSED_MESSAGE,
} from '../constants';
import { KitRefusalError } from '../client-core';
import { assertGatheringRead, decimalBigint, decimalNumber, filedPlaces, windowFactsOf } from '../gathering/edge';
import { proofOf } from '../gathering/order';
import type { AttemptRequest, CancelRequest, Gathering, Moment, ProofPlace, Reply, Selection } from '../interfaces';
import { submissionFindings } from '../validation';
import { emptyFindings } from '../validation/common';
import { checkedRequest } from '../validation/request-parse';
import { ruleCountFindings } from '../validation/request-proofs';

/** The submission the record's own members make with the given proofs, its numbers converted from the record's decimal strings. */
export function requestOf(record: Gathering, proofs: readonly ProofPlace[]): AttemptRequest | CancelRequest {
  const { request } = record;
  const shared = {
    account: request.account,
    action: request.action,
    attemptId: decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId'),
    setupNonce: decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce'),
    setupBody: request.setupBody,
    validUntil: decimalNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil'),
    proofs,
  };

  if (record.purpose === 'cancellation') return shared;

  const { order } = record.request;
  const amount = decimalBigint(order.amount, FORMATS_AMOUNT_BITS, 'order.amount');

  return { ...shared, payload: record.request.payload, order: { token: order.token, amount, payee: order.payee } };
}

/** The proofs the rule is judged over: every filed reply, or the selection's places where each one is filled. */
function candidateProofs(record: Gathering, selection: Selection | undefined): ProofPlace[] | undefined {
  const filed = filedPlaces(record);
  const places = selection === undefined ? [...filed.keys()] : [...new Set(selection)];
  const replies = places.map((place) => filed.get(place)?.reply);

  if (replies.some((reply) => reply === undefined)) return undefined;

  return (replies as Reply[]).map(proofOf).sort((left, right) => left.place - right.place);
}

/**
 * Refuses a completion with a `KitRefusalError` carrying the findings where the window has passed at `now`, then where the
 * filed replies, or the selection, do not satisfy the rule. A selection naming a place no reply fills is left to the ordering,
 * which throws a `RangeError` for it.
 */
export function assertCompletable(record: Gathering, selection: Selection | undefined, now: Moment): void {
  assertGatheringRead(record);

  const facts = windowFactsOf(record);
  const window = submissionFindings(facts, now);

  if (window.errors.length > 0) throw new KitRefusalError(GATHERING_WINDOW_PASSED_MESSAGE, { findings: window });

  const proofs = candidateProofs(record, selection);

  if (proofs === undefined) return;

  const candidate = requestOf(record, proofs);
  const checked = checkedRequest(candidate);
  const findings = emptyFindings();

  ruleCountFindings(checked, findings);

  if (findings.errors.length > 0) throw new KitRefusalError(GATHERING_RULE_UNSATISFIED_MESSAGE, { findings });
}
