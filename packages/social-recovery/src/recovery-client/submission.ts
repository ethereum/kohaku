import { FORMATS_SAFE_INTEGER_BITS, RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE } from '../constants';
import { KitRefusalError } from '../client-core';
import { assertUintNumber } from '../formats/guards';
import type { AttemptRequest, CancelRequest, Hex, Moment, ProofPlace } from '../interfaces';
import { assertBoundRequest } from '../policy-manager/calldata';
import type { RecoveryClientParts } from '../types/recovery-client';
import { checkedRequest } from '../validation/request-parse';

/** Refuses with the encoder's `RangeError`, naming the lowest repeated place, checked proofs that name one place twice; their order is left to the encoder. */
function assertDistinctPlaces(proofs: readonly ProofPlace[]): void {
  const places = proofs.map(({ place }) => place).sort((left, right) => left - right);
  const repeated = places.find((place, index) => index > 0 && place === places[index - 1]);

  if (repeated !== undefined) throw new RangeError(`proofs place ${repeated} is repeated: places must be strictly increasing`);
}

/**
 * Refuses with a `TypeError` or `RangeError` a submission whose members are not the shapes its record declares, an opening
 * passed where a cancellation is expected or the reverse, proofs repeating a place (the encoder's `RangeError`; proofs out of
 * order are not refused, since the encoder sorts them), a moment that is not a non-negative safe integer, and a request
 * naming another account or action than the client is bound to.
 */
export function assertSubmission(parts: RecoveryClientParts, request: AttemptRequest | CancelRequest, opening: boolean, now: Moment): void {
  const checked = checkedRequest(request);

  if (checked.opening !== opening) {
    throw new TypeError(opening ? 'request must be an opening request with a payload and an order' : 'request must be a cancel request');
  }

  assertDistinctPlaces(checked.proofs);
  assertUintNumber(now, FORMATS_SAFE_INTEGER_BITS, 'now');
  assertBoundRequest(request, parts.account, parts.action);
}

/** Refuses with a `KitRefusalError` carrying one `handover.malformed` finding a payload the codec does not decode. */
export function assertPayloadDecodes(parts: RecoveryClientParts, payload: Hex): void {
  try {
    parts.codec.decode(payload);
  } catch {
    throw new KitRefusalError(RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE, {
      findings: {
        errors: [{ code: 'handover.malformed', subject: 'request', values: { zeroNew: false, zeroRemoved: false, layoutDecodes: false } }],
        warnings: [],
      },
    });
  }
}
