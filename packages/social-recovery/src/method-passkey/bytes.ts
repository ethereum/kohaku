import * as Base64 from 'ox/Base64';
import { bytesToHex, hexToBytes, isHex, sha256, stringToHex } from 'viem';
import { METHOD_PASSKEY_ARRAY_BUFFER_TAG, METHOD_PASSKEY_UINT256_LIMIT, METHOD_PASSKEY_WORD_HEX_LENGTH } from '../constants';
import type { Hex } from '../interfaces';

/** An even-length `0x` hex string, either case. */
export const isHexBytes = (value: unknown): value is Hex =>
  typeof value === 'string' && isHex(value, { strict: true }) && value.length % 2 === 0;

/** A 32-byte word as hex. */
export const isWord = (value: unknown): value is Hex => isHexBytes(value) && value.length === METHOD_PASSKEY_WORD_HEX_LENGTH;

/** A `uint256` value. */
export const isUint256 = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value < METHOD_PASSKEY_UINT256_LIMIT;

/** The relying-party hash, `sha256` of the id's UTF-8 bytes. */
export const rpIdHashOf = (relyingPartyId: string): Hex => sha256(stringToHex(relyingPartyId));

/** WebAuthn's base64url rendering of the digest, without padding. */
export const challengeText = (digest: Hex): string => Base64.fromBytes(hexToBytes(digest), { url: true, pad: false });

/** Strict UTF-8 text of bytes, or undefined where the bytes are not UTF-8. */
export const utf8Text = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
};

/** A copy of an `ArrayBuffer`'s or view's bytes, or undefined; read by tag so a buffer from another realm counts. */
export const bufferBytes = (value: unknown): Uint8Array | undefined => {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }

  if (Object.prototype.toString.call(value) === METHOD_PASSKEY_ARRAY_BUFFER_TAG) {
    return new Uint8Array(value as ArrayBuffer).slice();
  }

  return undefined;
};

/** A member of an object-shaped value, or undefined. */
export const memberOf = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? (value as { readonly [key: string]: unknown })[name] : undefined;

/** Lower-case hex of bytes. */
export const hexOf = (bytes: Uint8Array): Hex => bytesToHex(bytes);
