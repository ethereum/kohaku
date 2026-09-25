import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import {
  METHOD_ZKPASSPORT_BYTES_PATTERN,
  METHOD_ZKPASSPORT_CONFIG_LAYOUT,
  METHOD_ZKPASSPORT_PROOF_DATA_FIELDS,
  METHOD_ZKPASSPORT_PROOF_FIELDS,
  METHOD_ZKPASSPORT_PROOF_LAYOUT,
  METHOD_ZKPASSPORT_UINT256_LIMIT,
  METHOD_ZKPASSPORT_WORD_PATTERN,
} from '../constants';
import type { IMethodCodec } from '../interfaces';
import type { FieldValue, Fields, Hex } from '../interfaces';
import type { ZkPassportConfig, ZkPassportProof } from '../types';

const fail = (layout: string, why: string): never => {
  throw new Error(`method-zkpassport ${layout}: ${why}`);
};

const exactly = (value: FieldValue | Fields | undefined, names: readonly string[], layout: string): Fields => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(layout, 'expected a record');

  const record = value as Fields;
  const keys = Object.keys(record);

  if (keys.length !== names.length || !names.every((name) => keys.includes(name))) {
    fail(layout, `expected exactly the fields ${names.map((name) => `"${name}"`).join(', ')}`);
  }

  return record;
};

const word = (value: unknown, layout: string, name: string): Hex =>
  typeof value === 'string' && METHOD_ZKPASSPORT_WORD_PATTERN.test(value) ? (value.toLowerCase() as Hex) : fail(layout, `"${name}" is not 32 bytes of hex`);

const bytes = (value: unknown, layout: string, name: string): Hex =>
  typeof value === 'string' && METHOD_ZKPASSPORT_BYTES_PATTERN.test(value) ? (value.toLowerCase() as Hex) : fail(layout, `"${name}" is not whole bytes of hex`);

const text = (value: unknown, layout: string, name: string): string =>
  typeof value === 'string' ? value : fail(layout, `"${name}" is not a string`);

const uint256 = (value: unknown, layout: string, name: string): bigint => {
  const n = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;

  if (typeof n !== 'bigint' || n < 0n || n >= METHOD_ZKPASSPORT_UINT256_LIMIT) return fail(layout, `"${name}" is not a uint256`);

  return n;
};

/** Reads config fields into the record, refusing extra, missing or ill-typed fields. */
export const configFromFields = (fields: Fields): ZkPassportConfig => {
  const f = exactly(fields, METHOD_ZKPASSPORT_CONFIG_LAYOUT.map((member) => member.name), 'config');

  return {
    uniqueIdentifier: word(f['uniqueIdentifier'], 'config', 'uniqueIdentifier'),
    version: word(f['version'], 'config', 'version'),
    domain: text(f['domain'], 'config', 'domain'),
    scope: text(f['scope'], 'config', 'scope'),
    validityPeriodInSeconds: uint256(f['validityPeriodInSeconds'], 'config', 'validityPeriodInSeconds'),
  };
};

/** Reads proof fields into the record, refusing extra, missing or ill-typed fields. */
export const proofFromFields = (fields: Fields): ZkPassportProof => {
  const f = exactly(fields, METHOD_ZKPASSPORT_PROOF_FIELDS, 'proof');
  const data = exactly(f['proofVerificationData'], METHOD_ZKPASSPORT_PROOF_DATA_FIELDS, 'proof');
  const inputs = data['publicInputs'];

  if (!Array.isArray(inputs)) return fail('proof', '"publicInputs" is not a list');

  return {
    proofVerificationData: {
      vkeyHash: word(data['vkeyHash'], 'proof', 'vkeyHash'),
      proof: bytes(data['proof'], 'proof', 'proof'),
      publicInputs: inputs.map((input: unknown) => word(input, 'proof', 'publicInputs')),
    },
    committedInputs: bytes(f['committedInputs'], 'proof', 'committedInputs'),
  };
};

/** `abi.encode` of the config, lower-case hex. */
export const encodeZkPassportConfig = (config: ZkPassportConfig): Hex =>
  encodeAbiParameters(METHOD_ZKPASSPORT_CONFIG_LAYOUT, [
    config.uniqueIdentifier,
    config.version,
    config.domain,
    config.scope,
    config.validityPeriodInSeconds,
  ]);

/** `abi.encode` of the proof, lower-case hex. */
export const encodeZkPassportProof = (proof: ZkPassportProof): Hex =>
  encodeAbiParameters(METHOD_ZKPASSPORT_PROOF_LAYOUT, [
    { ...proof.proofVerificationData, publicInputs: [...proof.proofVerificationData.publicInputs] },
    proof.committedInputs,
  ]);

/** Decodes, then refuses bytes the encode would not reproduce (compared case-insensitively). */
const strictly = <T>(bytesIn: Hex, layout: string, decode: (b: Hex) => T, encode: (v: T) => Hex): T => {
  if (typeof bytesIn !== 'string' || !METHOD_ZKPASSPORT_BYTES_PATTERN.test(bytesIn)) return fail(layout, 'not whole bytes of hex');

  let value: T;

  try {
    value = decode(bytesIn);
  } catch {
    return fail(layout, `not an ABI encoding of the ${layout} layout`);
  }

  if (encode(value) !== bytesIn.toLowerCase()) fail(layout, 'bytes the encoding would not reproduce');

  return value;
};

/** The config the bytes hold; throws on any byte string the encode would not reproduce. */
export const decodeZkPassportConfig = (config: Hex): ZkPassportConfig =>
  strictly(
    config,
    'config',
    (b) => {
      const [uniqueIdentifier, version, domain, scope, validityPeriodInSeconds] = decodeAbiParameters(METHOD_ZKPASSPORT_CONFIG_LAYOUT, b);

      return { uniqueIdentifier, version, domain, scope, validityPeriodInSeconds };
    },
    encodeZkPassportConfig,
  );

/** The proof the bytes hold; throws on any byte string the encode would not reproduce. */
export const decodeZkPassportProof = (proof: Hex): ZkPassportProof =>
  strictly(
    proof,
    'proof',
    (b) => {
      const [proofVerificationData, committedInputs] = decodeAbiParameters(METHOD_ZKPASSPORT_PROOF_LAYOUT, b);

      return { proofVerificationData, committedInputs };
    },
    encodeZkPassportProof,
  );

/** The method's codec, with `validityPeriodInSeconds` as a bigint. */
export const zkPassportCodec: IMethodCodec = {
  encodeConfig: (fields: Fields): Hex => encodeZkPassportConfig(configFromFields(fields)),
  decodeConfig: (config: Hex): Fields => ({ ...decodeZkPassportConfig(config) }),
  encodeProof: (fields: Fields): Hex => encodeZkPassportProof(proofFromFields(fields)),
  decodeProof: (proof: Hex): Fields => {
    const { proofVerificationData, committedInputs } = decodeZkPassportProof(proof);

    return { proofVerificationData: { ...proofVerificationData }, committedInputs };
  },
};
