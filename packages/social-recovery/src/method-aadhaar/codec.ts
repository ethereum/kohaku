import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import {
  METHOD_AADHAAR_B_PAIRS,
  METHOD_AADHAAR_CANONICAL_MESSAGE,
  METHOD_AADHAAR_CONFIG_ABI,
  METHOD_AADHAAR_CONFIG_BYTES,
  METHOD_AADHAAR_CONFIG_FIELDS,
  METHOD_AADHAAR_CONFIG_NAME,
  METHOD_AADHAAR_EXTRA_FIELD_MESSAGE,
  METHOD_AADHAAR_LENGTH_MESSAGE,
  METHOD_AADHAAR_PROOF_ABI,
  METHOD_AADHAAR_PROOF_BYTES,
  METHOD_AADHAAR_PROOF_FIELDS,
  METHOD_AADHAAR_PROOF_NAME,
  METHOD_AADHAAR_PUBLIC_INPUT_COUNT,
} from '../constants/method-aadhaar';
import { assertBytes, assertObject } from '../formats/guards';
import type { Fields, Hex, IMethodCodec } from '../interfaces';
import type { AadhaarConfig, AadhaarNineWords, AadhaarPair, AadhaarProof } from '../types/method-aadhaar';
import { entryAt, requireList, requirePair, requireWord, requireWords } from './words';

/** Refuses a non-object with a `TypeError`, and names the first field the layout does not have. */
function requireOnly(fields: Fields, names: readonly string[], layout: string): void {
  assertObject(fields, layout);

  const extra = Object.keys(fields).find((name) => !names.includes(name));

  if (extra !== undefined) throw new TypeError(`${layout} ${extra} ${METHOD_AADHAAR_EXTRA_FIELD_MESSAGE}`);
}

/** Whole bytes of hex (`TypeError`) of exactly `length` bytes (`RangeError`). */
function requireBytes(bytes: Hex, length: number, name: string): void {
  assertBytes(bytes, name);

  if (bytes.length !== 2 + 2 * length) throw new RangeError(`${name} ${METHOD_AADHAAR_LENGTH_MESSAGE} ${length}`);
}

function requireCanonical(bytes: Hex, encoded: Hex, name: string): void {
  if (encoded.toLowerCase() !== bytes.toLowerCase()) throw new TypeError(`${name} ${METHOD_AADHAAR_CANONICAL_MESSAGE}`);
}

export function encodeConfig(fields: Fields): Hex {
  const [nullifierField, seedField, windowField] = METHOD_AADHAAR_CONFIG_FIELDS;

  requireOnly(fields, METHOD_AADHAAR_CONFIG_FIELDS, METHOD_AADHAAR_CONFIG_NAME);

  const nullifier = requireWord(fields[nullifierField], nullifierField);
  const nullifierSeed = requireWord(fields[seedField], seedField);
  const freshnessWindow = requireWord(fields[windowField], windowField);

  return encodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, [nullifier, nullifierSeed, freshnessWindow]);
}

export function decodeConfig(config: Hex): AadhaarConfig {
  requireBytes(config, METHOD_AADHAAR_CONFIG_BYTES, METHOD_AADHAAR_CONFIG_NAME);

  const [nullifier, nullifierSeed, freshnessWindow] = decodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, config);
  const encoded = encodeAbiParameters(METHOD_AADHAAR_CONFIG_ABI, [nullifier, nullifierSeed, freshnessWindow]);

  requireCanonical(config, encoded, METHOD_AADHAAR_CONFIG_NAME);

  return { nullifier, nullifierSeed, freshnessWindow };
}

export function encodeProof(fields: Fields): Hex {
  const [aField, bField, cField, inputsField] = METHOD_AADHAAR_PROOF_FIELDS;

  requireOnly(fields, METHOD_AADHAAR_PROOF_FIELDS, METHOD_AADHAAR_PROOF_NAME);

  const a = requirePair(fields[aField], aField);
  const rows = requireList(fields[bField], METHOD_AADHAAR_B_PAIRS, bField);
  const b: readonly [AadhaarPair, AadhaarPair] = [
    requirePair(entryAt(rows, 0, bField), `${bField}[0]`),
    requirePair(entryAt(rows, 1, bField), `${bField}[1]`),
  ];
  const c = requirePair(fields[cField], cField);
  // requireWords checked the count, so the list is the nine-word tuple.
  const inputs = requireWords(fields[inputsField], METHOD_AADHAAR_PUBLIC_INPUT_COUNT, inputsField) as readonly bigint[] as AadhaarNineWords;

  return encodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, [a, b, c, inputs]);
}

export function decodeProof(proof: Hex): AadhaarProof {
  requireBytes(proof, METHOD_AADHAAR_PROOF_BYTES, METHOD_AADHAAR_PROOF_NAME);

  const [a, b, c, inputs] = decodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, proof);

  requireCanonical(proof, encodeAbiParameters(METHOD_AADHAAR_PROOF_ABI, [a, b, c, inputs]), METHOD_AADHAAR_PROOF_NAME);

  return { a: [...a], b: [[...b[0]], [...b[1]]], c: [...c], inputs: [...inputs] };
}

/** The method's codec; each encode refuses a field outside its layout, each decode bytes its encode would not reproduce. */
export const aadhaarCodec: IMethodCodec = { encodeConfig, decodeConfig, encodeProof, decodeProof };
