import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type Hex = `0x${string}`;

export { concatBytes } from "@noble/hashes/utils.js";

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Big-endian bytes to an integer. */
export const toBig = (bytes: Uint8Array): bigint => {
  let value = 0n;

  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  return value;
};

/** An integer as `size` big-endian bytes; throws when it does not fit. */
export const be = (value: bigint | number, size: number): Uint8Array => {
  let rest = BigInt(value);
  const out = new Uint8Array(size);

  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }

  if (rest !== 0n) throw new Error(`tacit: value does not fit ${size} bytes`);

  return out;
};

const U256 = 1n << 256n;

/** An ABI word: two's complement for negative values. */
export const word = (value: bigint | number): Uint8Array => be(((BigInt(value) % U256) + U256) % U256, 32);

export const hex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export const unhex = (value: string): Uint8Array => hexToBytes(value.startsWith("0x") ? value.slice(2) : value);

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);
