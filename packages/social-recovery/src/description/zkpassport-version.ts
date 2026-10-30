import { METHOD_ZKPASSPORT_VERSION_PART_BYTES, METHOD_ZKPASSPORT_VERSION_PARTS } from '../constants/method-zkpassport';
import { METHOD_ZKPASSPORT_DECIMAL_PATTERN } from '../constants/method-zkpassport-parse';
import { assertBytes32 } from '../formats/guards';
import type { Hex } from '../interfaces';

const PART_DIGITS = METHOD_ZKPASSPORT_VERSION_PART_BYTES * 2;
const PART_LIMIT = 2 ** (METHOD_ZKPASSPORT_VERSION_PART_BYTES * 8);
const WORD_DIGITS = 64;
const HEAD_DIGITS = 2 + METHOD_ZKPASSPORT_VERSION_PARTS * PART_DIGITS;

const isDecimal = (part: string): boolean => METHOD_ZKPASSPORT_DECIMAL_PATTERN.test(part);

/**
 * The version a zkPassport trusted-key word names, as `major.minor.patch`. The peer's `params.version` is this word;
 * compare it with `trustedKeys[METHOD_ZKPASSPORT_VERSION_KEY]` by value, as the module's `verify` routes by it.
 * A `TypeError` for a word that is not 32 bytes or carries a non-zero byte past the parts.
 */
export function zkPassportVersionOf(word: Hex): string {
  assertBytes32(word, 'word');

  if (BigInt(`0x0${word.slice(HEAD_DIGITS)}`) !== 0n) throw new TypeError('word must be zero past its version parts');

  const parts: number[] = [];

  for (let start = 2; start < HEAD_DIGITS; start += PART_DIGITS) {
    parts.push(Number.parseInt(word.slice(start, start + PART_DIGITS), 16));
  }

  return parts.join('.');
}

/**
 * The trusted-key word naming a `major.minor.patch` version, lower-case, the encoding of the peer's `params.version`.
 * A `TypeError` unless the version is three decimal parts each below 65536.
 */
export function zkPassportVersionWord(version: string): Hex {
  if (typeof version !== 'string') throw new TypeError('version must be a string');

  const parts = version.split('.');

  if (parts.length !== METHOD_ZKPASSPORT_VERSION_PARTS || !parts.every(isDecimal)) {
    throw new TypeError('version must be three decimal parts, major.minor.patch');
  }

  const values = parts.map(Number);

  if (!values.every((value) => value < PART_LIMIT)) throw new TypeError(`version parts must each be below ${PART_LIMIT}`);

  const head = values.map((value) => value.toString(16).padStart(PART_DIGITS, '0')).join('');

  return `0x${head.padEnd(WORD_DIGITS, '0')}`;
}
