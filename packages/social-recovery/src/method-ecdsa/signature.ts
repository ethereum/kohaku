import { type Hex, isAddressEqual, recoverAddress } from 'viem';
import {
  METHOD_ECDSA_BYTE_HEX_LENGTH,
  METHOD_ECDSA_CURVE_ORDER,
  METHOD_ECDSA_HALF_ORDER,
  METHOD_ECDSA_HEX_BYTES,
  METHOD_ECDSA_HEX_PREFIX_LENGTH,
  METHOD_ECDSA_RECOVERY_HIGH,
  METHOD_ECDSA_RECOVERY_LOW,
  METHOD_ECDSA_SIGNATURE_END,
  METHOD_ECDSA_SIGNATURE_LENGTH,
  METHOD_ECDSA_SIGNATURE_R_OFFSET,
  METHOD_ECDSA_SIGNATURE_S_OFFSET,
  METHOD_ECDSA_SIGNATURE_V_OFFSET,
  METHOD_ECDSA_WORD_HEX_LENGTH,
  METHOD_ECDSA_ZERO_ADDRESS,
} from '../constants';
import type { SignatureParts } from '../types';

/** Whether a value is a string of whole bytes as 0x-prefixed hex, empty allowed. */
export const isHexBytes = (value: unknown): value is Hex =>
  typeof value === 'string' && METHOD_ECDSA_HEX_BYTES.test(value);

/** The byte length of a value `isHexBytes` accepted. */
export const byteLength = (bytes: Hex): number => (bytes.length - METHOD_ECDSA_HEX_PREFIX_LENGTH) / METHOD_ECDSA_BYTE_HEX_LENGTH;

const split = (signature: Hex): SignatureParts => ({
  r: BigInt(`0x${signature.slice(METHOD_ECDSA_SIGNATURE_R_OFFSET, METHOD_ECDSA_SIGNATURE_S_OFFSET)}`),
  s: BigInt(`0x${signature.slice(METHOD_ECDSA_SIGNATURE_S_OFFSET, METHOD_ECDSA_SIGNATURE_V_OFFSET)}`),
  v: Number.parseInt(signature.slice(METHOD_ECDSA_SIGNATURE_V_OFFSET, METHOD_ECDSA_SIGNATURE_END), 16),
});

const word = (value: bigint): string => value.toString(16).padStart(METHOD_ECDSA_WORD_HEX_LENGTH, '0');

const join = ({ r, s, v }: SignatureParts): Hex =>
  `0x${word(r)}${word(s)}${v.toString(16).padStart(METHOD_ECDSA_BYTE_HEX_LENGTH, '0')}`;

/**
 * The signature in the form OpenZeppelin's `ECDSA` accepts: low `s` and a recovery byte of 27 or 28.
 * Bytes of another length or recovery byte, such as an ERC-1271 wallet's, return lower-cased and otherwise unchanged.
 */
export const normalizeSignature = (signature: Hex): Hex => {
  const lower = signature.toLowerCase() as Hex;

  if (byteLength(lower) !== METHOD_ECDSA_SIGNATURE_LENGTH) return lower;

  const parts = split(lower);
  const recovery = parts.v < METHOD_ECDSA_RECOVERY_LOW ? parts.v + METHOD_ECDSA_RECOVERY_LOW : parts.v;

  if (recovery !== METHOD_ECDSA_RECOVERY_LOW && recovery !== METHOD_ECDSA_RECOVERY_HIGH) return lower;

  if (parts.s <= METHOD_ECDSA_HALF_ORDER || parts.s >= METHOD_ECDSA_CURVE_ORDER) return join({ ...parts, v: recovery });

  return join({
    r: parts.r,
    s: METHOD_ECDSA_CURVE_ORDER - parts.s,
    v: recovery === METHOD_ECDSA_RECOVERY_LOW ? METHOD_ECDSA_RECOVERY_HIGH : METHOD_ECDSA_RECOVERY_LOW,
  });
};

/**
 * Whether the signature recovers to the signer under the digest.
 * False for every shape OpenZeppelin's `ECDSA` refuses and for the zero signer, so a local yes is never wider than the chain's.
 */
export const keyPathPasses = async (digest: Hex, signature: Hex, signer: Hex): Promise<boolean> => {
  if (byteLength(signature) !== METHOD_ECDSA_SIGNATURE_LENGTH) return false;

  const { r, s, v } = split(signature);

  if (v !== METHOD_ECDSA_RECOVERY_LOW && v !== METHOD_ECDSA_RECOVERY_HIGH) return false;

  if (r === 0n || r >= METHOD_ECDSA_CURVE_ORDER || s === 0n || s > METHOD_ECDSA_HALF_ORDER) return false;

  if (isAddressEqual(signer, METHOD_ECDSA_ZERO_ADDRESS)) return false;

  try {
    const recovered = await recoverAddress({ hash: digest, signature });

    return isAddressEqual(recovered, signer);
  } catch {
    return false;
  }
};
