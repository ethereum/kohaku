import { encodeAbiParameters, getAddress, isAddress } from 'viem';
import {
  METHOD_ECDSA_CONFIG_ABI,
  METHOD_ECDSA_CONFIG_ADDRESS_OFFSET,
  METHOD_ECDSA_CONFIG_BYTES_MESSAGE,
  METHOD_ECDSA_CONFIG_FIELD,
  METHOD_ECDSA_CONFIG_SIGNER_MESSAGE,
  METHOD_ECDSA_CONFIG_WORD,
  METHOD_ECDSA_PROOF_BYTES_MESSAGE,
  METHOD_ECDSA_PROOF_FIELD,
  METHOD_ECDSA_PROOF_SIGNATURE_MESSAGE,
  METHOD_ECDSA_ZERO_ADDRESS,
} from '../constants';
import type { IMethodCodec } from '../interfaces';
import type { Address, Fields, Hex } from '../interfaces';
import { isHexBytes } from './signature';

const onlyField = (fields: Fields, name: string, layout: string): unknown => {
  const names = Object.keys(fields);

  if (names.length !== 1 || names[0] !== name) {
    throw new Error(`method-ecdsa ${layout}: expected exactly the field "${name}"`);
  }

  return fields[name];
};

/** A 20-byte hex address whose checksum is valid where it is mixed case. */
const isWellFormedAddress = (value: unknown): value is Address =>
  typeof value === 'string' && isAddress(value, { strict: true });

/** An address a guardian may enroll with: well formed and not the zero address. */
export const isGuardianAddress = (value: unknown): value is Address =>
  isWellFormedAddress(value) && value.toLowerCase() !== METHOD_ECDSA_ZERO_ADDRESS;

/** `abi.encode(address signer)`, lower-case hex. */
export const encodeSigner = (signer: Address): Hex => encodeAbiParameters(METHOD_ECDSA_CONFIG_ABI, [signer]);

/** The signer a config word holds, checksummed; throws unless the bytes are one zero-padded address word. */
export const decodeSigner = (config: Hex): Address => {
  if (typeof config !== 'string' || !METHOD_ECDSA_CONFIG_WORD.test(config)) {
    throw new Error(METHOD_ECDSA_CONFIG_BYTES_MESSAGE);
  }

  return getAddress(`0x${config.slice(METHOD_ECDSA_CONFIG_ADDRESS_OFFSET)}`);
};

/**
 * The codec: the config is `abi.encode(address signer)` and the proof is the raw signature bytes.
 * Each decode throws on bytes its encode would not reproduce, ignoring case; the zero address encodes, enrollment refuses it.
 */
export const walletCodec: IMethodCodec = {
  encodeConfig(fields: Fields): Hex {
    const signer = onlyField(fields, METHOD_ECDSA_CONFIG_FIELD, 'config');

    if (!isWellFormedAddress(signer)) {
      throw new Error(METHOD_ECDSA_CONFIG_SIGNER_MESSAGE);
    }

    return encodeSigner(signer);
  },

  decodeConfig(config: Hex): Fields {
    return { [METHOD_ECDSA_CONFIG_FIELD]: decodeSigner(config) };
  },

  encodeProof(fields: Fields): Hex {
    const signature = onlyField(fields, METHOD_ECDSA_PROOF_FIELD, 'proof');

    if (!isHexBytes(signature)) {
      throw new Error(METHOD_ECDSA_PROOF_SIGNATURE_MESSAGE);
    }

    return signature.toLowerCase() as Hex;
  },

  decodeProof(proof: Hex): Fields {
    if (!isHexBytes(proof)) {
      throw new Error(METHOD_ECDSA_PROOF_BYTES_MESSAGE);
    }

    return { [METHOD_ECDSA_PROOF_FIELD]: proof.toLowerCase() };
  },
};
