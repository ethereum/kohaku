import * as Base64 from 'ox/Base64';
import { bytesToHex, hexToBytes, sha256, stringToHex } from 'viem';
import { METHOD_PASSKEY_ARRAY_BUFFER_TAG } from '../constants';
import type { Hex } from '../interfaces';

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
