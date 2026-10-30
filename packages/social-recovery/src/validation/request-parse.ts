import {
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_PLACE_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
} from '../constants';
import { assertArray, assertBool, assertBytes, assertBytes32, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from '../formats/guards';
import { checkedPaymentOrder } from '../formats/payment-order';
import { decodeSetupBody } from '../formats/setup-body';
import type { AttemptRequest, CancelRequest, ProofPlace } from '../interfaces';
import type { SetupBody } from '../types';
import type { CheckedRequest, RequestValidationContext } from '../types/validation';

/** One proof's place and method checked and the method checksummed; the order of places is judged, not refused. */
function checkedProof(proof: ProofPlace, name: string): ProofPlace {
  assertObject(proof, name);
  assertUintNumber(proof.place, FORMATS_PLACE_BITS, `${name}.place`);
  assertBytes(proof.config, `${name}.config`);
  assertBytes32(proof.salt, `${name}.salt`);
  assertBytes(proof.proof, `${name}.proof`);

  return { ...proof, method: normalizeAddress(proof.method, `${name}.method`) };
}

/** The setup body the request reveals, or undefined where its bytes do not decode as one. */
function revealedBody(setupBody: CancelRequest['setupBody']): SetupBody | undefined {
  try {
    return decodeSetupBody(setupBody);
  } catch {
    return undefined;
  }
}

/** Checked copies of every proof in array order, refusing a hole in the list. */
function checkedProofs(proofs: readonly ProofPlace[]): ProofPlace[] {
  const checked: ProofPlace[] = [];

  for (let index = 0; index < proofs.length; index += 1) {
    if (!Object.hasOwn(proofs, index)) throw new TypeError(`request.proofs[${index}] is missing`);

    checked.push(checkedProof(proofs[index] as ProofPlace, `request.proofs[${index}]`));
  }

  return checked;
}

/** Refuses a request whose members are not the shapes the record declares, and returns a checked copy in array order. */
export function checkedRequest(request: AttemptRequest | CancelRequest): CheckedRequest {
  assertObject(request, 'request');
  assertUintBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'request.attemptId');
  assertUintBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'request.setupNonce');
  assertBytes(request.setupBody, 'request.setupBody');
  assertUintNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'request.validUntil');
  assertArray(request.proofs, 'request.proofs');

  const shared = {
    account: normalizeAddress(request.account, 'request.account'),
    action: normalizeAddress(request.action, 'request.action'),
    attemptId: request.attemptId,
    setupNonce: request.setupNonce,
    setupBody: request.setupBody,
    validUntil: request.validUntil,
    proofs: checkedProofs(request.proofs),
    body: revealedBody(request.setupBody),
  };

  if (!('order' in request)) return { ...shared, opening: false };

  assertBytes(request.payload, 'request.payload');

  return { ...shared, opening: true, payload: request.payload, order: checkedPaymentOrder(request.order, 'request.order') };
}

/** Refuses a context whose records are not the shapes they declare, and an opening request's context missing its reads. */
export function assertRequestContext(context: RequestValidationContext, opening: boolean): void {
  assertObject(context, 'context');
  assertObject(context.state, 'context.state');
  assertObject(context.state.attempt, 'context.state.attempt');
  assertObject(context.block, 'context.block');
  assertObject(context.configuration, 'context.configuration');
  assertArray(context.paused, 'context.paused');
  assertArray(context.implementedMethods, 'context.implementedMethods');

  if (!opening) return;

  assertObject(context.handover, 'context.handover');
  assertObject(context.handover.handover, 'context.handover.handover');
  assertBool(context.handover.layoutDecodes, 'context.handover.layoutDecodes');
  assertBool(context.handover.newHoldsAnyPrivilege, 'context.handover.newHoldsAnyPrivilege');
  assertUintBigint(context.balance, FORMATS_AMOUNT_BITS, 'context.balance');
}
