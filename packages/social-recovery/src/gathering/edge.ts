import {
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_DECIMAL_PATTERN,
  FORMATS_SAFE_INTEGER_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  GATHERING_KIND,
  GATHERING_UNREAD_RECORD_MESSAGE,
  GATHERING_VERSION,
} from '../constants';
import { setupBodyHash } from '../formats/commitments';
import { approvalDigest, cancellationDigest } from '../formats/digests';
import { assertUintBigint, assertUintNumber } from '../formats/guards';
import type { Gathering, Hex } from '../interfaces';
import type { WindowFacts } from '../types/validation';
import type { CancellationMembers, SetupBody } from '../types';
import type { FiledPlace } from '../types/gathering';

/** A record decimal string as a bigint, refusing another spelling and a value outside [0, 2^bits). */
export function decimalBigint(value: unknown, bits: number, name: string): bigint {
  if (typeof value !== 'string' || !FORMATS_DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a decimal string`);
  }

  const parsed = BigInt(value);

  assertUintBigint(parsed, bits, name);

  return parsed;
}

/** A record decimal string as a number, refusing what `decimalBigint` refuses and a value past the safe-integer range. */
export function decimalNumber(value: unknown, bits: number, name: string): number {
  const parsed = decimalBigint(value, Math.max(bits, FORMATS_SAFE_INTEGER_BITS), name);
  const converted = Number(parsed);

  assertUintNumber(converted, bits, name);

  return converted;
}

/** Whether the record is of the kind and version this build reads. */
export function isGatheringRead(record: unknown): record is Gathering {
  return (
    typeof record === 'object' &&
    record !== null &&
    (record as Gathering).kind === GATHERING_KIND &&
    (record as Gathering).version === GATHERING_VERSION
  );
}

/** Throws where the record's kind or version is not the one this build reads. */
export function assertGatheringRead(record: Gathering): void {
  if (!isGatheringRead(record)) {
    throw new TypeError(GATHERING_UNREAD_RECORD_MESSAGE);
  }
}

/** How many places the body names, one per credential across its clauses. */
export const placeCount = (body: SetupBody): number => body.clauses.reduce((total, clause) => total + clause.credentials.length, 0);

/** The places a filed reply fills, keyed by place: only places of the map, each at its first reply in filing order. */
export function filedPlaces(record: Gathering): Map<number, FiledPlace> {
  const filed = new Map<number, FiledPlace>();

  record.replies.forEach((reply, filedAt) => {
    const entry = record.places.find((candidate) => candidate.place === reply.place);

    if (entry !== undefined && !filed.has(reply.place)) {
      filed.set(reply.place, { entry, reply, filedAt });
    }
  });

  return filed;
}

/** The members both digests share, converted from the record's decimal strings. */
function sharedMembers(record: Gathering): CancellationMembers {
  const { request } = record;

  return {
    chainId: decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'chainId'),
    manager: request.manager,
    account: request.account,
    action: request.action,
    attemptId: decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId'),
    setupNonce: decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce'),
    setupBodyHash: setupBodyHash(request.setupBody),
    validUntil: decimalNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil'),
    digestVersion: decimalBigint(request.digestVersion, FORMATS_SAFE_INTEGER_BITS, 'digestVersion').toString(),
  };
}

/** The digest this gathering's own members produce for one place under the record's domain; throws on a malformed member. */
export function digestFor(record: Gathering, place: number): Hex {
  const shared = sharedMembers(record);

  if (record.purpose === 'cancellation') {
    return cancellationDigest(shared, place);
  }

  const { order } = record.request;

  return approvalDigest(
    {
      ...shared,
      payload: record.request.payload,
      order: { token: order.token, amount: decimalBigint(order.amount, FORMATS_AMOUNT_BITS, 'order.amount'), payee: order.payee },
    },
    place,
  );
}

/** The record's window as the window findings read it. */
export function windowFactsOf(record: Gathering): WindowFacts {
  const validUntil = decimalNumber(record.request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');
  const blockTimestamp = decimalNumber(record.request.block.timestamp, FORMATS_SAFE_INTEGER_BITS, 'block.timestamp');

  if (record.purpose === 'cancellation') {
    return {
      validUntil,
      blockTimestamp,
      consumableAfter: decimalNumber(record.request.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'consumableAfter'),
    };
  }

  return { validUntil, blockTimestamp };
}
