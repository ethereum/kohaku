import { FORMATS_AMOUNT_BITS, FORMATS_ATTEMPT_ID_BITS, FORMATS_SETUP_NONCE_BITS, FORMATS_VALID_UNTIL_BITS } from '../constants';
import { decimalBigint, decimalNumber } from '../gathering/edge';
import type { AttemptRequest, CancelRequest, Gathering, ProofPlace } from '../interfaces';

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
