import { decodeAbiParameters, encodeAbiParameters, hexToBytes, stringToHex } from 'viem';
import {
  METHOD_PASSKEY_P256_HALF_ORDER,
  METHOD_PASSKEY_CODEC_REFUSALS,
  METHOD_PASSKEY_CONFIG_ABI,
  METHOD_PASSKEY_CONFIG_FIELDS,
  METHOD_PASSKEY_CONFIG_HEX_LENGTH,
  METHOD_PASSKEY_ERROR_PREFIX,
  METHOD_PASSKEY_LAYOUT_CONFIG,
  METHOD_PASSKEY_LAYOUT_PROOF,
  METHOD_PASSKEY_PROOF_ABI,
  METHOD_PASSKEY_PROOF_FIELDS,
} from '../constants';
import type { IMethodCodec } from '../interfaces';
import type { Fields, Hex } from '../interfaces';
import type { PasskeyConfig, PasskeyProof } from '../types';
import { isHexBytes, isUint256, isWord, utf8Text } from './bytes';

const fail = (layout: string, why: string): never => {
  throw new Error(`${METHOD_PASSKEY_ERROR_PREFIX} ${layout}: ${why}`);
};

const exactly = (fields: Fields, names: readonly string[], layout: string): void => {
  const given = Object.keys(fields).sort();
  const wanted = [...names].sort();

  if (given.length !== wanted.length || given.some((name, index) => name !== wanted[index])) {
    fail(layout, `expected exactly the fields ${wanted.join(', ')}`);
  }
};

/** `abi.encode(x, y, rpIdHash)`, lower-case hex; throws on a value the layout cannot hold. */
export const encodePasskeyConfig = (config: PasskeyConfig): Hex => {
  if (!isUint256(config.x) || !isUint256(config.y)) fail(METHOD_PASSKEY_LAYOUT_CONFIG, METHOD_PASSKEY_CODEC_REFUSALS.configUint256);

  if (!isWord(config.rpIdHash)) fail(METHOD_PASSKEY_LAYOUT_CONFIG, METHOD_PASSKEY_CODEC_REFUSALS.configRpIdHash);

  return encodeAbiParameters(METHOD_PASSKEY_CONFIG_ABI, [config.x, config.y, config.rpIdHash.toLowerCase() as Hex]);
};

/** The config's fields; throws on any bytes `encodePasskeyConfig` would not reproduce. */
export const decodePasskeyConfig = (config: Hex): PasskeyConfig => {
  if (!isHexBytes(config) || config.length !== METHOD_PASSKEY_CONFIG_HEX_LENGTH) {
    fail(METHOD_PASSKEY_LAYOUT_CONFIG, METHOD_PASSKEY_CODEC_REFUSALS.configWords);
  }

  const [x, y, rpIdHash] = decodeAbiParameters(METHOD_PASSKEY_CONFIG_ABI, config);

  return { x, y, rpIdHash: rpIdHash.toLowerCase() as Hex };
};

/** `abi.encode(authenticatorData, clientDataJSON, r, s)`, lower-case hex; throws on a high `s`. */
export const encodePasskeyProof = (proof: PasskeyProof): Hex => {
  if (!isHexBytes(proof.authenticatorData)) fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofAuthenticatorData);

  if (typeof proof.clientDataJSON !== 'string') fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofClientDataText);

  if (!isUint256(proof.r) || !isUint256(proof.s)) fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofUint256);

  if (proof.s > METHOD_PASSKEY_P256_HALF_ORDER) fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofHighS);

  return encodeAbiParameters(METHOD_PASSKEY_PROOF_ABI, [
    proof.authenticatorData.toLowerCase() as Hex,
    stringToHex(proof.clientDataJSON),
    proof.r,
    proof.s,
  ]);
};

/** The proof's fields; throws on any bytes `encodePasskeyProof` would not reproduce. */
export const decodePasskeyProof = (proof: Hex): PasskeyProof => {
  if (!isHexBytes(proof)) fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofHex);

  let decoded: readonly [Hex, Hex, bigint, bigint];

  try {
    decoded = decodeAbiParameters(METHOD_PASSKEY_PROOF_ABI, proof);
  } catch {
    return fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofLayout);
  }

  const [authenticatorData, clientDataBytes, r, s] = decoded;
  const clientDataJSON = utf8Text(hexToBytes(clientDataBytes));

  if (clientDataJSON === undefined) return fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofClientDataUtf8);

  const fields: PasskeyProof = { authenticatorData: authenticatorData.toLowerCase() as Hex, clientDataJSON, r, s };

  if (encodePasskeyProof(fields) !== proof.toLowerCase()) fail(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofCanonical);

  return fields;
};

const configOf = (fields: Fields): PasskeyConfig => {
  exactly(fields, METHOD_PASSKEY_CONFIG_FIELDS, METHOD_PASSKEY_LAYOUT_CONFIG);

  return fields as unknown as PasskeyConfig;
};

const proofOf = (fields: Fields): PasskeyProof => {
  exactly(fields, METHOD_PASSKEY_PROOF_FIELDS, METHOD_PASSKEY_LAYOUT_PROOF);

  return fields as unknown as PasskeyProof;
};

/** The passkey codec; each decode refuses bytes its encode would not reproduce, and each encode returns lower-case hex. */
export const passkeyCodec: IMethodCodec = {
  encodeConfig: (fields: Fields): Hex => encodePasskeyConfig(configOf(fields)),
  decodeConfig: (config: Hex): Fields => decodePasskeyConfig(config),
  encodeProof: (fields: Fields): Hex => encodePasskeyProof(proofOf(fields)),
  decodeProof: (proof: Hex): Fields => decodePasskeyProof(proof),
};
