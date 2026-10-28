import { checksumAddress, getAddress, size } from 'viem';
import {
  FORMATS_HEX_ADDRESS_PATTERN,
  FORMATS_HEX_BYTES32_PATTERN,
  FORMATS_HEX_BYTES_PATTERN,
  FORMATS_MISSING_MESSAGE,
  FORMATS_SAFE_INTEGER_BITS,
} from '../constants';
import { REMOVED_KEY_UNNAMED, type Address, type Hex, type PinnedBlock, type RemovedKey, type RemovedKeyUnnamed } from '../interfaces';

/** Refuses anything but whole bytes as 0x-prefixed hex, since an odd digit count would be padded into other bytes. */
export function assertBytes(value: unknown, name: string): asserts value is Hex {
  if (typeof value !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(value)) {
    throw new TypeError(`${name} must be 0x-prefixed hex of whole bytes`);
  }
}

/** Refuses anything but exactly 32 bytes as 0x-prefixed hex. */
export function assertBytes32(value: unknown, name: string): asserts value is Hex {
  if (typeof value !== 'string' || !FORMATS_HEX_BYTES32_PATTERN.test(value)) {
    throw new TypeError(`${name} must be exactly 32 bytes of 0x-prefixed hex`);
  }
}

/** Whether the hex digits mix lower- and upper-case letters, the only spelling that claims an EIP-55 checksum. */
function hasMixedCase(value: string): boolean {
  const digits = value.slice(2);

  return digits !== digits.toLowerCase() && digits !== digits.toUpperCase();
}

/** Refuses anything but 20 bytes of 0x-prefixed hex, and a mixed-case address whose EIP-55 checksum fails. */
export function assertAddress(value: unknown, name: string): asserts value is Address {
  if (
    typeof value !== 'string' ||
    !FORMATS_HEX_ADDRESS_PATTERN.test(value) ||
    (hasMixedCase(value) && checksumAddress(value as Address) !== value)
  ) {
    throw new TypeError(`${name} must be a 20-byte address`);
  }
}

/** Refuses what `assertAddress` refuses and returns the accepted address in its EIP-55 checksummed spelling. */
export function normalizeAddress(value: unknown, name: string): Address {
  assertAddress(value, name);

  return getAddress(value);
}

/** Refuses null, undefined and any other non-object before a member of it is read. */
export function assertObject(value: unknown, name: string): asserts value is object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${name} must be an object`);
  }
}

/** Refuses anything but a boolean. */
export function assertBool(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
}

/** Whether the value is a non-array object whose members can be read. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Refuses anything but an array. */
export function assertArray(value: unknown, name: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
}

/** Refuses a non-array and an array with no own value at a position below `length`, its own length by default. */
export function assertDense(value: unknown, name: string, length?: number): asserts value is readonly unknown[] {
  assertArray(value, name);

  const end = length ?? value.length;

  for (let index = 0; index < end; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${name}[${index}] ${FORMATS_MISSING_MESSAGE}`);
  }
}

/** Whether the value is a non-negative safe integer, as a block number, log index or count must be. */
export const isSafeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Refuses a non-integer with a `TypeError`, and a value outside [0, 2^bits) or the safe-integer range with a `RangeError`. */
export function assertUintNumber(value: unknown, bits: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }

  if (value < 0 || !Number.isSafeInteger(value) || (bits < FORMATS_SAFE_INTEGER_BITS && value >= 2 ** bits)) {
    throw new RangeError(`${name} ${value} does not fit uint${bits} as a safe integer`);
  }
}

/** Refuses a non-bigint with a `TypeError`, and a value outside [0, 2^bits) with a `RangeError`. */
export function assertUintBigint(value: unknown, bits: number, name: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new TypeError(`${name} must be a bigint`);
  }

  if (value < 0n || value >= 1n << BigInt(bits)) {
    throw new RangeError(`${name} ${value} does not fit uint${bits}`);
  }
}

/** The same address, compared without regard to case. */
export const sameAddress = (left: Address, right: Address): boolean => left.toLowerCase() === right.toLowerCase();

/** The byte length of 0x-prefixed hex of whole bytes. */
export const byteLength = (bytes: Hex): number => size(bytes);

/** The hex string lower-cased, for a value already checked. */
export const lowerHex = (value: Hex): Hex => value.toLowerCase() as Hex;

/** The block's number and lower-cased hash, refusing anything but a non-negative safe integer and a 32-byte hash. */
export function checkedBlock(value: unknown, name: string): PinnedBlock {
  assertObject(value, name);

  const { number, hash } = value as Partial<Record<keyof PinnedBlock, unknown>>;

  assertUintNumber(number, FORMATS_SAFE_INTEGER_BITS, `${name}.number`);
  assertBytes32(hash, `${name}.hash`);

  return { number, hash: lowerHex(hash) };
}

/** Refuses a dependency that is not an object with every named member callable. */
export function assertDependency(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);

  for (const member of members) {
    if (typeof (value as Readonly<Record<string, unknown>>)[member] !== 'function') throw new TypeError(`${name}.${member} must be a function`);
  }
}

/** The checksummed spellings of a list of addresses, refusing a value that is not an array, a hole in it and a malformed entry. */
export function normalizeAddresses(values: unknown, name: string): Address[] {
  assertArray(values, name);

  const normalized: Address[] = [];

  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) throw new TypeError(`${name}[${index}] ${FORMATS_MISSING_MESSAGE}`);

    normalized.push(normalizeAddress(values[index], `${name}[${index}]`));
  }

  return normalized;
}

/** Whether the removed key is one of the reasons no address could be named, rather than an address. */
export const isRemovedKeyUnnamed = (value: RemovedKey): value is RemovedKeyUnnamed =>
  (REMOVED_KEY_UNNAMED as readonly unknown[]).includes(value);
