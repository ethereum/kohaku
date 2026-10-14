import { isHex } from 'viem';
import {
  FORMATS_HEX_BYTES32_PATTERN,
  METHOD_ZKPASSPORT_BIND_DATA_KEY,
  METHOD_ZKPASSPORT_BIND_EVM_KEY,
  METHOD_ZKPASSPORT_CUSTOM_DATA_KEY,
  METHOD_ZKPASSPORT_DIGEST_HEX_MESSAGE,
  METHOD_ZKPASSPORT_DIGEST_WIDTH_MESSAGE,
  METHOD_ZKPASSPORT_MIN_PUBLIC_INPUTS,
  METHOD_ZKPASSPORT_MISSING_MESSAGE,
  METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER,
  METHOD_ZKPASSPORT_NULLIFIER_TYPE_FROM_END,
  METHOD_ZKPASSPORT_OUTER_EVM_PREFIX,
  METHOD_ZKPASSPORT_PROOFS_NAME,
  METHOD_ZKPASSPORT_RECORD_MESSAGE,
  METHOD_ZKPASSPORT_SCOPED_NULLIFIER_FROM_END,
  METHOD_ZKPASSPORT_WORD_HEX_LENGTH,
} from '../constants';
import { lowerHex } from '../formats/guards';
import type { Hex } from '../interfaces';
import type { ZkPassportStackProof } from '../types';

/** Whether the value is a non-array object whose members can be read. */
export const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The digest as the custom field's text, lower-case; `TypeError` on anything but hex, `RangeError` on hex that is not 32 bytes. */
export const digestText = (digest: Hex): string => {
  if (!isHex(digest, { strict: true })) throw new TypeError(METHOD_ZKPASSPORT_DIGEST_HEX_MESSAGE);

  if (!FORMATS_HEX_BYTES32_PATTERN.test(digest)) throw new RangeError(METHOD_ZKPASSPORT_DIGEST_WIDTH_MESSAGE);

  return lowerHex(digest);
};

/** The first proof named as the outer EVM proof, or undefined where none is; every index is walked first, so a hole or a non-record entry anywhere throws a `TypeError` naming its position. */
export const outerEvmProof = (proofs: unknown): ZkPassportStackProof | undefined => {
  if (!Array.isArray(proofs)) return undefined;

  let found: ZkPassportStackProof | undefined;

  for (let index = 0; index < proofs.length; index += 1) {
    if (!Object.hasOwn(proofs, index)) throw new TypeError(`${METHOD_ZKPASSPORT_PROOFS_NAME}[${index}] ${METHOD_ZKPASSPORT_MISSING_MESSAGE}`);

    const proof: unknown = proofs[index];

    if (!isRecord(proof)) throw new TypeError(`${METHOD_ZKPASSPORT_PROOFS_NAME}[${index}] ${METHOD_ZKPASSPORT_RECORD_MESSAGE}`);

    if (found === undefined && typeof proof['name'] === 'string' && proof['name'].startsWith(METHOD_ZKPASSPORT_OUTER_EVM_PREFIX)) {
      found = proof;
    }
  }

  return found;
};

/** The custom data the outer proof's bind committed inputs carry, or undefined where it carries none. */
export const boundCustomData = (proof: ZkPassportStackProof): string | undefined => {
  const committed: unknown = proof.committedInputs;

  if (!isRecord(committed)) return undefined;

  const bind = committed[METHOD_ZKPASSPORT_BIND_EVM_KEY];

  if (!isRecord(bind) || !isRecord(bind[METHOD_ZKPASSPORT_BIND_DATA_KEY])) return undefined;

  const custom = bind[METHOD_ZKPASSPORT_BIND_DATA_KEY][METHOD_ZKPASSPORT_CUSTOM_DATA_KEY];

  return typeof custom === 'string' ? custom : undefined;
};

const trailing = (publicInputs: readonly string[], fromEnd: number): bigint | undefined => {
  const value = publicInputs[publicInputs.length - fromEnd];

  return publicInputs.length >= METHOD_ZKPASSPORT_MIN_PUBLIC_INPUTS && typeof value === 'string' && FORMATS_HEX_BYTES32_PATTERN.test(value)
    ? BigInt(value)
    : undefined;
};

/** The outer proof's scoped nullifier, or undefined on a malformed list. */
export const scopedNullifier = (publicInputs: readonly string[]): bigint | undefined =>
  trailing(publicInputs, METHOD_ZKPASSPORT_SCOPED_NULLIFIER_FROM_END);

/** Whether the outer proof's nullifier type is the non-salted one; a dev-mode mock type is not. */
export const isNonSalted = (publicInputs: readonly string[]): boolean =>
  trailing(publicInputs, METHOD_ZKPASSPORT_NULLIFIER_TYPE_FROM_END) === METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER;

/** A unique identifier as the config's `bytes32` word, lower-case. */
export const identifierWord = (identifier: bigint): Hex =>
  `0x${identifier.toString(16).padStart(METHOD_ZKPASSPORT_WORD_HEX_LENGTH, '0')}`;
