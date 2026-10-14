import { FORMATS_DECIMAL_PATTERN } from '../constants/formats';
import {
  METHOD_AADHAAR_COUNT_MESSAGE,
  METHOD_AADHAAR_LIST_MESSAGE,
  METHOD_AADHAAR_MISSING_MESSAGE,
  METHOD_AADHAAR_PAIR_WORDS,
  METHOD_AADHAAR_PUBLIC_INPUTS,
  METHOD_AADHAAR_WORD_BITS,
  METHOD_AADHAAR_WORD_NAME,
} from '../constants/method-aadhaar';
import { assertUintBigint } from '../formats/guards';
import type { AadhaarPair, AadhaarPublicInput } from '../types/method-aadhaar';

/** One public input by name. */
export const inputAt = (inputs: readonly bigint[], name: AadhaarPublicInput): bigint | undefined =>
  inputs[METHOD_AADHAAR_PUBLIC_INPUTS.indexOf(name)];

/** A decimal string or a bigint as a `uint256`, or `undefined` when it is neither. */
export function parseWord(value: unknown): bigint | undefined {
  const word = typeof value === 'string' && FORMATS_DECIMAL_PATTERN.test(value) ? BigInt(value) : value;

  try {
    assertUintBigint(word, METHOD_AADHAAR_WORD_BITS, METHOD_AADHAAR_WORD_NAME);

    return word;
  } catch {
    return undefined;
  }
}

/** The first `count` entries as `uint256` words, or `undefined` for a hole, a missing entry or another value. */
export function parseWords(values: unknown, count: number): bigint[] | undefined {
  if (!Array.isArray(values) || values.length < count) return undefined;

  const words: bigint[] = [];

  for (let index = 0; index < count; index += 1) {
    const word = Object.hasOwn(values, index) ? parseWord(values[index]) : undefined;

    if (word === undefined) return undefined;

    words.push(word);
  }

  return words;
}

/** A coordinate pair parsed as `parseWords` does, or `undefined`. */
export function parsePair(values: unknown): AadhaarPair | undefined {
  const [first, second] = parseWords(values, METHOD_AADHAAR_PAIR_WORDS) ?? [];

  return first === undefined || second === undefined ? undefined : [first, second];
}

/** An array of exactly `count` entries: a `TypeError` for another value, a `RangeError` for another count. */
export function requireList(value: unknown, count: number, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} ${METHOD_AADHAAR_LIST_MESSAGE}`);

  if (value.length !== count) throw new RangeError(`${name} ${METHOD_AADHAAR_COUNT_MESSAGE} ${count}`);

  return value;
}

/** The entry at an index, refusing a hole with a `TypeError` naming the position. */
export function entryAt(list: readonly unknown[], index: number, name: string): unknown {
  if (!Object.hasOwn(list, index)) throw new TypeError(`${name}[${index}] ${METHOD_AADHAAR_MISSING_MESSAGE}`);

  return list[index];
}

function wordAt(list: readonly unknown[], index: number, name: string): bigint {
  const word = entryAt(list, index, name);

  assertUintBigint(word, METHOD_AADHAAR_WORD_BITS, `${name}[${index}]`);

  return word;
}

/** Exactly `count` `uint256` words, walked by index; the guards' `TypeError` or `RangeError` names the field. */
export function requireWords(value: unknown, count: number, name: string): bigint[] {
  const list = requireList(value, count, name);
  const words: bigint[] = [];

  for (let index = 0; index < list.length; index += 1) words.push(wordAt(list, index, name));

  return words;
}

/** One coordinate pair, checked as `requireWords` does. */
export function requirePair(value: unknown, name: string): AadhaarPair {
  const list = requireList(value, METHOD_AADHAAR_PAIR_WORDS, name);

  return [wordAt(list, 0, name), wordAt(list, 1, name)];
}

/** One named `uint256` field: a `TypeError` for a non-bigint, a `RangeError` outside the word. */
export function requireWord(value: unknown, name: string): bigint {
  assertUintBigint(value, METHOD_AADHAAR_WORD_BITS, name);

  return value;
}
