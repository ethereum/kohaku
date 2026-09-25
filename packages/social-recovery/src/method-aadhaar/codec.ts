import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import {
  METHOD_AADHAAR_B_PAIRS,
  METHOD_AADHAAR_CONFIG_ABI,
  METHOD_AADHAAR_CONFIG_BYTES,
  METHOD_AADHAAR_HEX_PATTERN,
  METHOD_AADHAAR_PAIR_WORDS,
  METHOD_AADHAAR_PROOF_ABI,
  METHOD_AADHAAR_PROOF_BYTES,
  METHOD_AADHAAR_PUBLIC_INPUT_COUNT,
} from '../constants/method-aadhaar';
import type { Fields, Hex, IMethodCodec } from '../interfaces';
import type { AadhaarConfig, AadhaarNineWords, AadhaarPair, AadhaarProof } from '../types';
import { requireWord, requireWords } from './words';

const pair = (words: readonly bigint[]): AadhaarPair => [words[0] ?? 0n, words[1] ?? 0n];

function requirePair(value: Fields[string] | undefined, name: string): AadhaarPair {
  return pair(requireWords(value, METHOD_AADHAAR_PAIR_WORDS, name));
}

function requireBytes(bytes: Hex, length: number, name: string): void {
  if (typeof bytes !== 'string' || !METHOD_AADHAAR_HEX_PATTERN.test(bytes) || bytes.length !== 2 + 2 * length) {
    throw new TypeError(`${name} is not ${length} bytes as 0x-prefixed hex`);
  }
}

function requireCanonical(bytes: Hex, encoded: Hex, name: string): void {
  if (encoded.toLowerCase() !== bytes.toLowerCase()) {
    throw new TypeError(`${name} does not re-encode to the bytes it was decoded from`);
  }
}

export function encodeConfig(fields: Fields): Hex {
  const nullifier = requireWord(fields['nullifier'], 'nullifier');
  const nullifierSeed = requireWord(fields['nullifierSeed'], 'nullifierSeed');

  return encodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, [nullifier, nullifierSeed]);
}

export function decodeConfig(config: Hex): AadhaarConfig {
  requireBytes(config, METHOD_AADHAAR_CONFIG_BYTES, 'the config');

  const [nullifier, nullifierSeed] = decodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, config);

  requireCanonical(config, encodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, [nullifier, nullifierSeed]), 'the config');

  return { nullifier, nullifierSeed };
}

export function encodeProof(fields: Fields): Hex {
  const a = requirePair(fields['a'], 'a');
  const rows = fields['b'];

  if (!Array.isArray(rows) || rows.length !== METHOD_AADHAAR_B_PAIRS) throw new TypeError('b is not a list of two pairs');

  const b: readonly [AadhaarPair, AadhaarPair] = [requirePair(rows[0], 'b[0]'), requirePair(rows[1], 'b[1]')];
  const c = requirePair(fields['c'], 'c');
  // requireWords checked the count, so the list is the nine-word tuple.
  const inputs = requireWords(fields['inputs'], METHOD_AADHAAR_PUBLIC_INPUT_COUNT, 'inputs') as readonly bigint[] as AadhaarNineWords;

  return encodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, [a, b, c, inputs]);
}

export function decodeProof(proof: Hex): AadhaarProof {
  requireBytes(proof, METHOD_AADHAAR_PROOF_BYTES, 'the proof');

  const [a, b, c, inputs] = decodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, proof);

  requireCanonical(proof, encodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, [a, b, c, inputs]), 'the proof');

  return { a: pair(a), b: [pair(b[0]), pair(b[1])], c: pair(c), inputs: [...inputs] };
}

/** The method's codec; each decode refuses bytes its encode would not reproduce. */
export const aadhaarCodec: IMethodCodec = { encodeConfig, decodeConfig, encodeProof, decodeProof };
