import { METHOD_AADHAAR_DECIMAL_PATTERN, METHOD_AADHAAR_PUBLIC_INPUTS, METHOD_AADHAAR_WORD_LIMIT } from '../constants/method-aadhaar';
import type { FieldValue } from '../interfaces';
import type { AadhaarPublicInput } from '../types';

/** One public input by name. */
export const inputAt = (inputs: readonly bigint[], name: AadhaarPublicInput): bigint | undefined =>
  inputs[METHOD_AADHAAR_PUBLIC_INPUTS.indexOf(name)];

/** Whether a value is a bigint an ABI `uint256` holds. */
export const isWord = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value < METHOD_AADHAAR_WORD_LIMIT;

/** A decimal string or a bigint as a `uint256`, or `undefined` when it is neither. */
export function parseWord(value: unknown): bigint | undefined {
  const word = typeof value === 'string' && METHOD_AADHAAR_DECIMAL_PATTERN.test(value) ? BigInt(value) : value;

  return isWord(word) ? word : undefined;
}

/** One named `uint256` field, or a TypeError naming it. */
export function requireWord(value: FieldValue | undefined, name: string): bigint {
  if (!isWord(value)) throw new TypeError(`${name} is not a uint256 as a bigint`);

  return value;
}

/** A list of exactly `count` `uint256` fields, or a TypeError naming it. */
export function requireWords(value: FieldValue | undefined, count: number, name: string): bigint[] {
  if (!Array.isArray(value) || value.length !== count) {
    throw new TypeError(`${name} is not a list of ${count} uint256 values`);
  }

  return value.map((word: FieldValue, index: number) => requireWord(word, `${name}[${index}]`));
}
