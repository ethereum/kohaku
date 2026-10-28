import { FORMATS_ATTEMPT_ID_BITS, FORMATS_CHAIN_ID_BITS, FORMATS_SETUP_NONCE_BITS, GATHERING_KIND, GATHERING_VERSION } from '../constants';
import { credentialHash } from '../formats/commitments';
import { decodeSetupBody } from '../formats/setup-body';
import { assertObject, normalizeAddress } from '../formats/guards';
import { PURPOSES } from '../interfaces';
import type { Gathering, GatheringPlace } from '../interfaces';
import type { GatheringMembers } from '../types';
import { decimalBigint, decimalNumber, digestFor, windowFactsOf } from './edge';

/** The request block with its addresses checksummed and every nested value copied. */
function copiedRequest(members: GatheringMembers): GatheringMembers {
  const copy = structuredClone(members);
  const addresses = {
    manager: normalizeAddress(copy.request.manager, 'manager'),
    account: normalizeAddress(copy.request.account, 'account'),
    action: normalizeAddress(copy.request.action, 'action'),
  };

  if (copy.purpose === 'cancellation') {
    return { purpose: copy.purpose, request: { ...copy.request, ...addresses } };
  }

  const order = {
    ...copy.request.order,
    token: normalizeAddress(copy.request.order.token, 'order.token'),
    payee: normalizeAddress(copy.request.order.payee, 'order.payee'),
  };

  return { purpose: copy.purpose, request: { ...copy.request, ...addresses, order } };
}

/**
 * The record a gathering starts from, with no replies and the version this build writes.
 * Throws on a malformed member or purpose, where the place map does not number the body's credentials in order,
 * and where a place's method, config and salt do not commit to the body's credential at that place.
 */
export function seed(members: GatheringMembers, places: readonly GatheringPlace[]): Gathering {
  assertObject(members, 'members');
  assertObject(members.request, 'members.request');

  if (!PURPOSES.includes(members.purpose)) {
    throw new TypeError(`purpose must be one of ${PURPOSES.join(', ')}`);
  }

  const { request, purpose } = copiedRequest(members);
  const record = { kind: GATHERING_KIND, version: GATHERING_VERSION, purpose, request, places: [], replies: [] } as Gathering;
  const committed = decodeSetupBody(request.setupBody).clauses.flatMap((clause) => clause.credentials);

  decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'chainId');
  decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  windowFactsOf(record);
  digestFor(record, 0);

  if (!Array.isArray(places) || places.length !== committed.length || places.some((entry, index) => entry?.place !== index)) {
    throw new RangeError(`the place map must number the body's ${committed.length} credentials in order`);
  }

  places.forEach((entry, index) => {
    if (credentialHash(entry.method, entry.config, entry.salt).toLowerCase() !== committed[index]?.toLowerCase()) {
      throw new TypeError(`place ${index} does not commit to the body's credential hash at that place`);
    }
  });

  return { ...record, places: structuredClone(places) };
}
