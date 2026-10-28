import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import {
  METHOD_ZKPASSPORT_CONFIG_FIELDS,
  METHOD_ZKPASSPORT_CONFIG_LAYOUT,
  METHOD_ZKPASSPORT_CONFIG_NAME,
  METHOD_ZKPASSPORT_CONFIG_SIGNATURE,
  METHOD_ZKPASSPORT_FIELDS_MESSAGE,
  METHOD_ZKPASSPORT_MISSING_MESSAGE,
  METHOD_ZKPASSPORT_PROOF_DATA_FIELDS,
  METHOD_ZKPASSPORT_PROOF_FIELDS,
  METHOD_ZKPASSPORT_PROOF_LAYOUT,
  METHOD_ZKPASSPORT_PROOF_NAME,
  METHOD_ZKPASSPORT_PROOF_SIGNATURE,
  METHOD_ZKPASSPORT_RECORD_MESSAGE,
  METHOD_ZKPASSPORT_TEXT_MESSAGE,
  METHOD_ZKPASSPORT_VALIDITY_BITS,
} from '../constants';
import { assertArray, assertBytes, assertBytes32, assertUintBigint, lowerHex } from '../formats/guards';
import { decodeStrictly } from '../formats/strict';
import type { IMethodCodec } from '../interfaces';
import type { Fields, Hex } from '../interfaces';
import type { ZkPassportConfig, ZkPassportProof } from '../types';
import { isRecord } from './bindings';

const exactly = (value: unknown, names: readonly string[], name: string): Fields => {
  if (!isRecord(value)) throw new TypeError(`${name} ${METHOD_ZKPASSPORT_RECORD_MESSAGE}`);

  const keys = Object.keys(value);

  if (keys.length !== names.length || !names.every((field) => Object.hasOwn(value, field))) {
    throw new TypeError(`${name} ${METHOD_ZKPASSPORT_FIELDS_MESSAGE} ${names.join(', ')}`);
  }

  return value as Fields;
};

const word = (value: unknown, name: string): Hex => {
  assertBytes32(value, name);

  return lowerHex(value);
};

const bytes = (value: unknown, name: string): Hex => {
  assertBytes(value, name);

  return lowerHex(value);
};

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${name} ${METHOD_ZKPASSPORT_TEXT_MESSAGE}`);

  return value;
};

/** A uint256, also taken as a safe-integer number since the stack reports the validity period as one. */
const uint256 = (value: unknown, name: string): bigint => {
  const candidate = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;

  assertUintBigint(candidate, METHOD_ZKPASSPORT_VALIDITY_BITS, name);

  return candidate;
};

/** Each entry as a lower-cased 32-byte word, walked by index so a hole is refused by its position. */
const words = (value: unknown, name: string): Hex[] => {
  assertArray(value, name);

  const walked: Hex[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${name}[${index}] ${METHOD_ZKPASSPORT_MISSING_MESSAGE}`);

    walked.push(word(value[index], `${name}[${index}]`));
  }

  return walked;
};

/** Reads config fields into the record; `TypeError` on extra, missing or ill-typed fields, `RangeError` on a validity outside uint256. */
export const configFromFields = (fields: Fields): ZkPassportConfig => {
  const name = METHOD_ZKPASSPORT_CONFIG_NAME;
  const f = exactly(fields, METHOD_ZKPASSPORT_CONFIG_FIELDS, name);

  return {
    uniqueIdentifier: word(f['uniqueIdentifier'], `${name}.uniqueIdentifier`),
    domain: text(f['domain'], `${name}.domain`),
    scope: text(f['scope'], `${name}.scope`),
    validityPeriodInSeconds: uint256(f['validityPeriodInSeconds'], `${name}.validityPeriodInSeconds`),
  };
};

/** Reads proof fields into the record; `TypeError` on extra, missing or ill-typed fields and on a hole in `publicInputs`. */
export const proofFromFields = (fields: Fields): ZkPassportProof => {
  const name = METHOD_ZKPASSPORT_PROOF_NAME;
  const f = exactly(fields, METHOD_ZKPASSPORT_PROOF_FIELDS, name);
  const data = exactly(f['proofVerificationData'], METHOD_ZKPASSPORT_PROOF_DATA_FIELDS, `${name}.proofVerificationData`);

  return {
    proofVerificationData: {
      vkeyHash: word(data['vkeyHash'], `${name}.vkeyHash`),
      proof: bytes(data['proof'], `${name}.proof`),
      publicInputs: words(data['publicInputs'], `${name}.publicInputs`),
    },
    committedInputs: bytes(f['committedInputs'], `${name}.committedInputs`),
  };
};

/** `abi.encode` of the config, lower-case hex. */
export const encodeZkPassportConfig = (config: ZkPassportConfig): Hex =>
  encodeAbiParameters(METHOD_ZKPASSPORT_CONFIG_LAYOUT, [
    config.uniqueIdentifier,
    config.domain,
    config.scope,
    config.validityPeriodInSeconds,
  ]);

/** `abi.encode` of the proof, lower-case hex. */
export const encodeZkPassportProof = (proof: ZkPassportProof): Hex => {
  const { vkeyHash, proof: proofBytes, publicInputs } = proof.proofVerificationData;

  return encodeAbiParameters(METHOD_ZKPASSPORT_PROOF_LAYOUT, [
    { vkeyHash, proof: proofBytes, publicInputs: [...publicInputs] },
    proof.committedInputs,
  ]);
};

/** The config the bytes hold; `TypeError` on bytes that are not hex, `RangeError` on bytes the encode would not reproduce. */
export const decodeZkPassportConfig = (config: Hex): ZkPassportConfig =>
  decodeStrictly(config, METHOD_ZKPASSPORT_CONFIG_NAME, METHOD_ZKPASSPORT_CONFIG_SIGNATURE, {
    decode: (encoded: Hex) => decodeAbiParameters(METHOD_ZKPASSPORT_CONFIG_LAYOUT, encoded),
    build: ([uniqueIdentifier, domain, scope, validityPeriodInSeconds]) => ({ uniqueIdentifier, domain, scope, validityPeriodInSeconds }),
    encode: encodeZkPassportConfig,
  });

/** The proof the bytes hold; `TypeError` on bytes that are not hex, `RangeError` on bytes the encode would not reproduce. */
export const decodeZkPassportProof = (proof: Hex): ZkPassportProof =>
  decodeStrictly(proof, METHOD_ZKPASSPORT_PROOF_NAME, METHOD_ZKPASSPORT_PROOF_SIGNATURE, {
    decode: (encoded: Hex) => decodeAbiParameters(METHOD_ZKPASSPORT_PROOF_LAYOUT, encoded),
    build: ([{ vkeyHash, proof: proofBytes, publicInputs }, committedInputs]) => ({
      proofVerificationData: { vkeyHash, proof: proofBytes, publicInputs },
      committedInputs,
    }),
    encode: encodeZkPassportProof,
  });

/** The method's codec, with `validityPeriodInSeconds` as a bigint. */
export const zkPassportCodec: IMethodCodec = {
  encodeConfig: (fields: Fields): Hex => encodeZkPassportConfig(configFromFields(fields)),
  decodeConfig: (config: Hex): Fields => {
    const { uniqueIdentifier, domain, scope, validityPeriodInSeconds } = decodeZkPassportConfig(config);

    return { uniqueIdentifier, domain, scope, validityPeriodInSeconds };
  },
  encodeProof: (fields: Fields): Hex => encodeZkPassportProof(proofFromFields(fields)),
  decodeProof: (proof: Hex): Fields => {
    const { proofVerificationData, committedInputs } = decodeZkPassportProof(proof);
    const { vkeyHash, proof: proofBytes, publicInputs } = proofVerificationData;

    return { proofVerificationData: { vkeyHash, proof: proofBytes, publicInputs }, committedInputs };
  },
};
