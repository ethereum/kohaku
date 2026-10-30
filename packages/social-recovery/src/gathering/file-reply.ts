import { FORMATS_ATTEMPT_ID_BITS, FORMATS_CHAIN_ID_BITS, GATHERING_REPLY_KIND, GATHERING_REPLY_VERSION } from '../constants';
import { assertBytes, normalizeAddress } from '../formats/guards';
import type { AddRefusalCause, AddResult, Gathering, GatheringPlace, Reply } from '../interfaces';
import { decimalBigint, digestFor, isGatheringRead } from './edge';

/** Whether a check holds, a malformed value counting as a failed one rather than a thrown error. */
function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

/** Whether two addresses name the same account under any accepted spelling. */
const sameAddress = (left: unknown, right: unknown): boolean =>
  holds(() => normalizeAddress(left, 'left') === normalizeAddress(right, 'right'));

/** Whether two values are the same hex bytes, compared without regard to letter case. */
const sameHex = (left: unknown, right: unknown): boolean =>
  typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();

/** Whether the reply names this gathering's chain, manager, account, action, attempt and purpose. */
function bindingMatches(record: Gathering, reply: Reply): boolean {
  const { request } = record;

  return (
    holds(() => decimalBigint(reply.chainId, FORMATS_CHAIN_ID_BITS, 'chainId') === decimalBigint(request.chainId, FORMATS_CHAIN_ID_BITS, 'chainId')) &&
    sameAddress(reply.manager, request.manager) &&
    sameAddress(reply.account, request.account) &&
    sameAddress(reply.action, request.action) &&
    holds(() => decimalBigint(reply.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId') === decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId')) &&
    reply.purpose === record.purpose
  );
}

/**
 * The first reason the reply cannot be filed, or none.
 * Throws a TypeError where a readable reply's proof or digest is not hex of whole bytes.
 */
function refusalOf(record: Gathering, reply: Reply): { cause: AddRefusalCause } | { place: GatheringPlace } {
  const readable =
    isGatheringRead(record) &&
    typeof reply === 'object' && reply !== null && reply.kind === GATHERING_REPLY_KIND && reply.version === GATHERING_REPLY_VERSION;

  if (!readable) {
    return { cause: 'kind-or-version-unread' };
  }

  assertBytes(reply.proof, 'reply.proof');
  assertBytes(reply.digest, 'reply.digest');

  if (!bindingMatches(record, reply)) {
    return { cause: 'binding-mismatch' };
  }

  const place = record.places.find((entry) => entry.place === reply.place);

  if (place === undefined) {
    return { cause: 'place-unknown' };
  }

  if (!holds(() => sameHex(digestFor(record, place.place), reply.digest))) {
    return { cause: 'digest-mismatch' };
  }

  if (!sameAddress(reply.method, place.method) || !sameHex(reply.config, place.config) || !sameHex(reply.salt, place.salt)) {
    return { cause: 'credential-mismatch' };
  }

  return { place };
}

/**
 * Files a reply into a new record, replacing in place a reply already filed for its place and naming it as displaced.
 * A refusal comes back as the typed result with an unchanged copy of the record; the proof itself is not judged.
 * Throws a TypeError where the reply's proof or digest is not hex of whole bytes.
 */
export function fileReply(record: Gathering, reply: Reply): AddResult {
  const verdict = refusalOf(record, reply);

  if ('cause' in verdict) {
    return { outcome: 'refused', gathering: structuredClone(record), reason: { kind: 'add-refusal', cause: verdict.cause } };
  }

  const copy = structuredClone(record);
  const filed = structuredClone(reply);
  const index = copy.replies.findIndex((entry) => entry.place === filed.place);

  if (index === -1) {
    return { outcome: 'filed', gathering: { ...copy, replies: [...copy.replies, filed] } };
  }

  const replies = copy.replies.map((entry, position) => (position === index ? filed : entry));

  return { outcome: 'filed', gathering: { ...copy, replies }, displaced: copy.replies[index] };
}
