import {
  concat,
  type Hex,
  hexToBigInt,
  hexToNumber,
  isAddressEqual,
  numberToHex,
  parseSignature,
  recoverAddress,
  size,
  slice,
} from 'viem';
import {
  METHOD_ECDSA_CURVE_ORDER,
  METHOD_ECDSA_HALF_ORDER,
  METHOD_ECDSA_HEX_BYTES,
  METHOD_ECDSA_RECOVERY_HIGH,
  METHOD_ECDSA_RECOVERY_LOW,
  METHOD_ECDSA_SIGNATURE_LENGTH,
  METHOD_ECDSA_SIGNATURE_WORD_SIZE,
  METHOD_ECDSA_ZERO_ADDRESS,
} from '../constants';
import type { SignatureParts } from '../types';

const WORD = METHOD_ECDSA_SIGNATURE_WORD_SIZE;

/** Whether a value is a string of whole bytes as 0x-prefixed hex, empty allowed. */
export const isHexBytes = (value: unknown): value is Hex =>
  typeof value === 'string' && METHOD_ECDSA_HEX_BYTES.test(value);

/** The byte length of a value `isHexBytes` accepted. */
export const byteLength = (bytes: Hex): number => size(bytes);

const split = (signature: Hex): SignatureParts => ({
  r: hexToBigInt(slice(signature, 0, WORD)),
  s: hexToBigInt(slice(signature, WORD, WORD + WORD)),
  v: hexToNumber(slice(signature, WORD + WORD)),
});

const join = ({ r, s, v }: SignatureParts): Hex =>
  concat([numberToHex(r, { size: WORD }), numberToHex(s, { size: WORD }), numberToHex(v, { size: 1 })]);

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

/** Whether viem parses the bytes as a signature with in-range `r` and `s`, a recovery byte of 27 or 28, and low `s`. */
const isStrictSignature = (signature: Hex): boolean => {
  if (byteLength(signature) !== METHOD_ECDSA_SIGNATURE_LENGTH) return false;

  try {
    const { s, v } = parseSignature(signature);

    return v !== undefined && hexToBigInt(s) <= METHOD_ECDSA_HALF_ORDER;
  } catch {
    return false;
  }
};

/**
 * Whether the signature recovers to the signer under the digest.
 * False for every shape OpenZeppelin's `ECDSA` refuses and for the zero signer, so a local yes is never wider than the chain's.
 */
export const keyPathPasses = async (digest: Hex, signature: Hex, signer: Hex): Promise<boolean> => {
  if (!isStrictSignature(signature) || isAddressEqual(signer, METHOD_ECDSA_ZERO_ADDRESS)) return false;

  try {
    const recovered = await recoverAddress({ hash: digest, signature });

    return isAddressEqual(recovered, signer);
  } catch {
    return false;
  }
};
