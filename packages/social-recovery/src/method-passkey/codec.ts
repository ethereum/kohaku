import { decodeAbiParameters, encodeAbiParameters, hexToBytes, stringToHex } from 'viem';
import {
  DESCRIPTION_PASSKEY_CONFIG_ABI,
  METHOD_PASSKEY_CODEC_REFUSALS,
  METHOD_PASSKEY_CONFIG_FIELDS,
  METHOD_PASSKEY_CONFIG_HEX_LENGTH,
  METHOD_PASSKEY_ERROR_PREFIX,
  METHOD_PASSKEY_LAYOUT_CONFIG,
  METHOD_PASSKEY_LAYOUT_PROOF,
  METHOD_PASSKEY_P256_HALF_ORDER,
  METHOD_PASSKEY_PROOF_ABI,
  METHOD_PASSKEY_PROOF_FIELDS,
  METHOD_PASSKEY_WORD_BITS,
} from '../constants';
import { assertBytes, assertBytes32, assertObject, assertUintBigint, lowerHex } from '../formats/guards';
import type { IMethodCodec } from '../interfaces';
import type { Fields, Hex } from '../interfaces';
import type { PasskeyConfig, PasskeyProof } from '../types/method-passkey';
import { utf8Text } from './bytes';

const [X_FIELD, Y_FIELD, RP_ID_HASH_FIELD] = METHOD_PASSKEY_CONFIG_FIELDS;
const [AUTHENTICATOR_DATA_FIELD, CLIENT_DATA_FIELD, R_FIELD, S_FIELD] = METHOD_PASSKEY_PROOF_FIELDS;

/** The name a refused layout, or one field of it, is reported under. */
const named = (layout: string, field?: string): string =>
  `${METHOD_PASSKEY_ERROR_PREFIX} ${layout}${field === undefined ? '' : ` ${field}`}`;

const shapeFault = (layout: string, why: string): never => {
  throw new TypeError(`${named(layout)}: ${why}`);
};

const rangeFault = (layout: string, why: string): never => {
  throw new RangeError(`${named(layout)}: ${why}`);
};

const exactly = (fields: unknown, names: readonly string[], layout: string): void => {
  assertObject(fields, named(layout));

  const given = Object.keys(fields).sort();
  const wanted = [...names].sort();

  if (given.length !== wanted.length || given.some((name, index) => name !== wanted[index])) {
    shapeFault(layout, `${METHOD_PASSKEY_CODEC_REFUSALS.fields} ${wanted.join(', ')}`);
  }
};

/** `abi.encode(x, y, rpIdHash)`, lower-case hex; a `TypeError` on a wrong type, a `RangeError` on a value out of `uint256`. */
export const encodePasskeyConfig = (config: PasskeyConfig): Hex => {
  assertUintBigint(config.x, METHOD_PASSKEY_WORD_BITS, named(METHOD_PASSKEY_LAYOUT_CONFIG, X_FIELD));
  assertUintBigint(config.y, METHOD_PASSKEY_WORD_BITS, named(METHOD_PASSKEY_LAYOUT_CONFIG, Y_FIELD));
  assertBytes32(config.rpIdHash, named(METHOD_PASSKEY_LAYOUT_CONFIG, RP_ID_HASH_FIELD));

  return encodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, [config.x, config.y, lowerHex(config.rpIdHash)]);
};

/** The config's fields; a `TypeError` on bytes that are not hex, a `RangeError` on any length but three words. */
export const decodePasskeyConfig = (config: Hex): PasskeyConfig => {
  assertBytes(config, named(METHOD_PASSKEY_LAYOUT_CONFIG));

  if (config.length !== METHOD_PASSKEY_CONFIG_HEX_LENGTH) rangeFault(METHOD_PASSKEY_LAYOUT_CONFIG, METHOD_PASSKEY_CODEC_REFUSALS.configWords);

  const [x, y, rpIdHash] = decodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, config);

  return { x, y, rpIdHash: lowerHex(rpIdHash) };
};

/** `abi.encode(authenticatorData, clientDataJSON, r, s)`, lower-case hex; a `RangeError` on a high `s`. */
export const encodePasskeyProof = (proof: PasskeyProof): Hex => {
  assertBytes(proof.authenticatorData, named(METHOD_PASSKEY_LAYOUT_PROOF, AUTHENTICATOR_DATA_FIELD));

  if (typeof proof.clientDataJSON !== 'string') {
    throw new TypeError(`${named(METHOD_PASSKEY_LAYOUT_PROOF, CLIENT_DATA_FIELD)} ${METHOD_PASSKEY_CODEC_REFUSALS.proofClientDataText}`);
  }

  assertUintBigint(proof.r, METHOD_PASSKEY_WORD_BITS, named(METHOD_PASSKEY_LAYOUT_PROOF, R_FIELD));
  assertUintBigint(proof.s, METHOD_PASSKEY_WORD_BITS, named(METHOD_PASSKEY_LAYOUT_PROOF, S_FIELD));

  if (proof.s > METHOD_PASSKEY_P256_HALF_ORDER) rangeFault(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofHighS);

  return encodeAbiParameters(METHOD_PASSKEY_PROOF_ABI, [
    lowerHex(proof.authenticatorData),
    stringToHex(proof.clientDataJSON),
    proof.r,
    proof.s,
  ]);
};

/** The proof's fields; a `TypeError` on any bytes `encodePasskeyProof` would not reproduce, a `RangeError` on a high `s`. */
export const decodePasskeyProof = (proof: Hex): PasskeyProof => {
  assertBytes(proof, named(METHOD_PASSKEY_LAYOUT_PROOF));

  let decoded: readonly [Hex, Hex, bigint, bigint];

  try {
    decoded = decodeAbiParameters(METHOD_PASSKEY_PROOF_ABI, proof);
  } catch {
    return shapeFault(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofLayout);
  }

  const [authenticatorData, clientDataBytes, r, s] = decoded;
  const clientDataJSON = utf8Text(hexToBytes(clientDataBytes));

  if (clientDataJSON === undefined) return shapeFault(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofClientDataUtf8);

  const fields: PasskeyProof = { authenticatorData: lowerHex(authenticatorData), clientDataJSON, r, s };

  if (encodePasskeyProof(fields) !== lowerHex(proof)) shapeFault(METHOD_PASSKEY_LAYOUT_PROOF, METHOD_PASSKEY_CODEC_REFUSALS.proofCanonical);

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
