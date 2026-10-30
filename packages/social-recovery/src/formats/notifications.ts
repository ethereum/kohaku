import { NOTIFICATION_KINDS } from '../interfaces';
import type { KitNotification, LogPosition } from '../interfaces';
import { assertAddress, assertArray, assertBool, assertBytes, assertBytes32, assertObject, isSafeCount } from './guards';

/** Orders notifications by block, then by log index; a tie keeps its arrival order. */
export const byPosition = (left: { readonly at: LogPosition }, right: { readonly at: LogPosition }): number =>
  left.at.blockNumber - right.at.blockNumber || left.at.logIndex - right.at.logIndex;

/** Refuses anything but a bigint. */
function assertBigint(value: unknown, name: string): asserts value is bigint {
  if (typeof value !== 'bigint') throw new TypeError(`${name} must be a bigint`);
}

/** Refuses anything but a non-negative safe integer. */
function assertCount(value: unknown, name: string): asserts value is number {
  if (!isSafeCount(value)) throw new TypeError(`${name} must be a non-negative safe integer`);
}

/** Refuses a position whose order or removal flag is not the shape it declares. */
function assertPosition(at: unknown, name: string): void {
  assertObject(at, name);

  const { blockNumber, logIndex, removed } = at as Partial<Record<keyof LogPosition, unknown>>;

  assertCount(blockNumber, `${name}.blockNumber`);
  assertCount(logIndex, `${name}.logIndex`);
  assertBool(removed, `${name}.removed`);
}

/** Refuses the account and action of a manager notification that are not addresses. */
function assertScope(entry: Readonly<Record<string, unknown>>, name: string): void {
  assertAddress(entry['account'], `${name}.account`);
  assertAddress(entry['action'], `${name}.action`);
}

/** Refuses an attempt opening whose id, scope, places or payload are not the shapes they declare. */
function assertOpening(entry: Readonly<Record<string, unknown>>, name: string): void {
  assertScope(entry, name);
  assertBigint(entry['attemptId'], `${name}.attemptId`);
  const places = entry['usedPlaces'];

  assertArray(places, `${name}.usedPlaces`);

  for (let index = 0; index < places.length; index += 1) assertBigint(places[index], `${name}.usedPlaces[${index}]`);
  assertBytes(entry['payload'], `${name}.payload`);
}

/** Refuses, with a `TypeError`, a notification of an undeclared kind or whose members the SDK reads are not the shapes they declare. */
export function assertNotification(value: unknown, name: string): asserts value is KitNotification {
  assertObject(value, name);

  const entry = value as Readonly<Record<string, unknown>>;
  const { kind, at } = entry;

  if (!(NOTIFICATION_KINDS as readonly unknown[]).includes(kind)) throw new TypeError(`${name}.kind must be a notification kind`);

  assertPosition(at, `${name}.at`);

  if (kind === 'attempt-started') {
    assertOpening(entry, name);
  } else if (kind === 'attempt-consumed') {
    assertScope(entry, name);
    assertBigint(entry['attemptId'], `${name}.attemptId`);
  } else if (kind === 'setup-committed') {
    assertScope(entry, name);
    assertBytes32((at as LogPosition).transactionHash, `${name}.at.transactionHash`);
    assertBytes32((at as LogPosition).blockHash, `${name}.at.blockHash`);
  } else if (kind === 'method-paused' || kind === 'method-unpaused') {
    assertAddress(entry['method'], `${name}.method`);
  }
}
