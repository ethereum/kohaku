import {
  METHOD_ZKPASSPORT_BIND_DATA_KEY,
  METHOD_ZKPASSPORT_BIND_EVM_KEY,
  METHOD_ZKPASSPORT_CUSTOM_DATA_KEY,
  METHOD_ZKPASSPORT_DIGEST_ERROR,
  METHOD_ZKPASSPORT_DIGEST_PATTERN,
  METHOD_ZKPASSPORT_MIN_PUBLIC_INPUTS,
  METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER,
  METHOD_ZKPASSPORT_NULLIFIER_TYPE_FROM_END,
  METHOD_ZKPASSPORT_OUTER_EVM_PREFIX,
  METHOD_ZKPASSPORT_SCOPED_NULLIFIER_FROM_END,
  METHOD_ZKPASSPORT_WORD_HEX_LENGTH,
  METHOD_ZKPASSPORT_WORD_PATTERN,
} from '../constants';
import type { Hex } from '../interfaces';
import type { StackProof } from '../types';

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The digest as the custom field's text, lower-case; throws on anything but 32 bytes of hex. */
export const digestText = (digest: Hex): string => {
  if (typeof digest !== 'string' || !METHOD_ZKPASSPORT_DIGEST_PATTERN.test(digest)) {
    throw new Error(METHOD_ZKPASSPORT_DIGEST_ERROR);
  }

  return digest.toLowerCase();
};

/** The first proof named as the outer EVM proof, or undefined where none is. */
export const outerEvmProof = (proofs: unknown): StackProof | undefined => {
  if (!Array.isArray(proofs)) return undefined;

  const found: unknown = proofs.find(
    (proof: unknown) =>
      isRecord(proof) && typeof proof['name'] === 'string' && proof['name'].startsWith(METHOD_ZKPASSPORT_OUTER_EVM_PREFIX),
  );

  return found as StackProof | undefined;
};

/** The custom data the outer proof's bind committed inputs carry, or undefined where it carries none. */
export const boundCustomData = (proof: StackProof): string | undefined => {
  const committed: unknown = proof.committedInputs;

  if (!isRecord(committed)) return undefined;

  const bind = committed[METHOD_ZKPASSPORT_BIND_EVM_KEY];

  if (!isRecord(bind) || !isRecord(bind[METHOD_ZKPASSPORT_BIND_DATA_KEY])) return undefined;

  const custom = bind[METHOD_ZKPASSPORT_BIND_DATA_KEY][METHOD_ZKPASSPORT_CUSTOM_DATA_KEY];

  return typeof custom === 'string' ? custom : undefined;
};

const trailing = (publicInputs: readonly string[], fromEnd: number): bigint | undefined => {
  const value = publicInputs[publicInputs.length - fromEnd];

  return publicInputs.length >= METHOD_ZKPASSPORT_MIN_PUBLIC_INPUTS && typeof value === 'string' && METHOD_ZKPASSPORT_WORD_PATTERN.test(value)
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
