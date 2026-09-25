import { BACKUP_HEX_BODY } from '../constants';
import type { Hex } from '../interfaces';

/** Whether `value` is 0x-prefixed hex of whole bytes, either case. */
export const isByteHex = (value: unknown): value is Hex =>
  typeof value === 'string' && value.startsWith('0x') && value.length % 2 === 0 && BACKUP_HEX_BODY.test(value.slice(2));

/** Decodes 0x-prefixed hex; throws a TypeError naming `what` when it is not hex of whole bytes. */
export function hexToBytes(value: unknown, what: string): Uint8Array<ArrayBuffer> {
  if (!isByteHex(value)) throw new TypeError(`${what} must be 0x-prefixed hex of whole bytes`);

  const bytes = new Uint8Array((value.length - 2) / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }

  return bytes;
}

/** Decodes 0x-prefixed hex of exactly `size` bytes. */
export function fixedHexToBytes(value: unknown, size: number, what: string): Uint8Array<ArrayBuffer> {
  const bytes = hexToBytes(value, what);

  if (bytes.length !== size) throw new TypeError(`${what} must be ${size} bytes, got ${bytes.length}`);

  return bytes;
}

/** Encodes bytes as lowercase 0x-prefixed hex. */
export const bytesToHex = (bytes: Uint8Array): Hex =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

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
