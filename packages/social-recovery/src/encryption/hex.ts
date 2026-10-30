import { bytesToHex as viemBytesToHex, hexToBytes as viemHexToBytes } from 'viem';
import { assertBytes } from '../formats/guards';
import type { Hex } from '../interfaces';

/** Decodes 0x-prefixed hex; throws a TypeError naming `what` when it is not hex of whole bytes. */
export function hexToBytes(value: unknown, what: string): Uint8Array<ArrayBuffer> {
  assertBytes(value, what);

  return new Uint8Array(viemHexToBytes(value));
}

/** Decodes 0x-prefixed hex of exactly `size` bytes. */
export function fixedHexToBytes(value: unknown, size: number, what: string): Uint8Array<ArrayBuffer> {
  const bytes = hexToBytes(value, what);

  if (bytes.length !== size) throw new TypeError(`${what} must be ${size} bytes, got ${bytes.length}`);

  return bytes;
}

/** Encodes bytes as lowercase 0x-prefixed hex. */
export const bytesToHex = (bytes: Uint8Array): Hex => viemBytesToHex(bytes);

/** Writes a non-negative bigint big-endian into `target` at `offset`, over `size` bytes. */
export function writeUint(target: Uint8Array, offset: number, size: number, value: bigint): void {
  let rest = value;

  for (let index = size - 1; index >= 0; index -= 1) {
    target[offset + index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
}

/** Reads `size` bytes big-endian from `source` at `offset` as a bigint. */
export function readUint(source: Uint8Array, offset: number, size: number): bigint {
  let value = 0n;

  for (let index = 0; index < size; index += 1) value = (value << 8n) | BigInt(source[offset + index] ?? 0);

  return value;
}
