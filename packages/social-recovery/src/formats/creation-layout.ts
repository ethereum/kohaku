import { bytesToHex, hexToBytes, pad } from 'viem';
import {
  FORMATS_ADDRESS_BYTES,
  FORMATS_CREATION_DEPLOY_HEAD,
  FORMATS_CREATION_DEPLOY_TAIL,
  FORMATS_CREATION_MAX_ENTRIES,
  FORMATS_CREATION_PUSH0_OPCODE,
  FORMATS_CREATION_RUNTIME_HEAD,
  FORMATS_CREATION_RUNTIME_TAIL,
  FORMATS_CREATION_SSTORE_OPCODE,
  FORMATS_CREATION_WORD_BYTES,
} from '../constants';
import type { Hex } from '../interfaces';
import type { CreationEntry } from '../types';

/** Whether `code` carries `expected` starting at byte `at`. */
function carriesAt(code: Uint8Array, at: number, expected: Uint8Array): boolean {
  return at + expected.length <= code.length && expected.every((byte, index) => code[at + index] === byte);
}

/** The byte after `expected` at `at`; throws a `RangeError` naming the part when the code differs there. */
function expectAt(code: Uint8Array, at: number, expected: Hex, part: string): number {
  const bytes = hexToBytes(expected);

  if (!carriesAt(code, at, bytes)) {
    throw new RangeError(`bytecode does not carry the ${part} at byte ${at}`);
  }

  return at + bytes.length;
}

/** The operand of a `PUSH1`..`PUSHmax` at `at` and the byte after it; anything else throws a `RangeError`. */
function pushAt(code: Uint8Array, at: number, maxBytes: number, part: string): { data: Uint8Array; next: number } {
  const width = (code[at] ?? 0) - FORMATS_CREATION_PUSH0_OPCODE;
  const next = at + 1 + width;

  if (width < 1 || width > maxBytes || next > code.length) {
    throw new RangeError(`bytecode does not push the ${part} at byte ${at} as 1 to ${maxBytes} bytes`);
  }

  return { data: code.subarray(at + 1, next), next };
}

/** The operand of a `PUSH` of exactly `width` bytes at `at` and the byte after it; any other push throws a `RangeError`. */
function exactPushAt(code: Uint8Array, at: number, width: number, part: string): { data: Uint8Array; next: number } {
  const next = at + 1 + width;

  if (code[at] !== FORMATS_CREATION_PUSH0_OPCODE + width || next > code.length) {
    throw new RangeError(`bytecode does not push the ${part} at byte ${at} as exactly ${width} bytes`);
  }

  return { data: code.subarray(at + 1, next), next };
}

/** One `(PUSHn value, PUSH32 slot, SSTORE)` entry at `at` and the byte after it. */
function entryAt(code: Uint8Array, at: number): { entry: CreationEntry; next: number } {
  const value = pushAt(code, at, FORMATS_CREATION_WORD_BYTES, 'stored value');
  const slot = exactPushAt(code, value.next, FORMATS_CREATION_WORD_BYTES, 'storage slot');

  if (code[slot.next] !== FORMATS_CREATION_SSTORE_OPCODE) {
    throw new RangeError(`bytecode does not store the entry at byte ${slot.next}`);
  }

  return {
    entry: { slot: bytesToHex(slot.data), value: pad(bytesToHex(value.data), { size: FORMATS_CREATION_WORD_BYTES }) },
    next: slot.next + 1,
  };
}

/**
 * The privilege entries of the account's proxy creation code, in code order.
 * Code that is not up to three entries followed by the minimal proxy's deploy code and runtime throws a `RangeError`,
 * as does an implementation pushed in fewer than 20 bytes, whose proxy's fixed runtime length and jump target would not hold.
 */
export function parseCreationEntries(bytecode: Hex): readonly CreationEntry[] {
  const code = hexToBytes(bytecode);
  const deployHead = hexToBytes(FORMATS_CREATION_DEPLOY_HEAD);
  const entries: CreationEntry[] = [];
  let at = 0;

  while (!carriesAt(code, at, deployHead)) {
    if (entries.length === FORMATS_CREATION_MAX_ENTRIES) {
      throw new RangeError(`bytecode writes more than ${FORMATS_CREATION_MAX_ENTRIES} entries or lacks the deploy code`);
    }

    const { entry, next } = entryAt(code, at);

    entries.push(entry);
    at = next;
  }

  const offset = code[at + deployHead.length];
  const runtimeStart = expectAt(code, at + deployHead.length + 1, FORMATS_CREATION_DEPLOY_TAIL, 'deploy code');

  if (offset !== runtimeStart) {
    throw new RangeError(`bytecode's runtime offset ${offset} is not its runtime's start ${runtimeStart}`);
  }

  const implementationStart = expectAt(code, runtimeStart, FORMATS_CREATION_RUNTIME_HEAD, 'proxy runtime');
  const implementation = exactPushAt(code, implementationStart, FORMATS_ADDRESS_BYTES, 'implementation');

  if (expectAt(code, implementation.next, FORMATS_CREATION_RUNTIME_TAIL, 'proxy runtime') !== code.length) {
    throw new RangeError('bytecode carries bytes after the proxy runtime');
  }

  return entries;
}
