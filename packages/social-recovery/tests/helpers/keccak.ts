const MASK = (1n << 64n) - 1n;
const RATE_BYTES = 136;

const ROTATIONS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
] as const;

/** The 24 round constants, derived from the LFSR of the Keccak reference rather than typed in. */
const ROUND_CONSTANTS: readonly bigint[] = (() => {
  const constants: bigint[] = [];
  let register = 1;

  const nextBit = (): number => {
    const bit = register & 1;

    register = (register & 0x80) !== 0 ? ((register << 1) ^ 0x71) & 0xff : (register << 1) & 0xff;

    return bit;
  };

  for (let round = 0; round < 24; round += 1) {
    let constant = 0n;

    for (let j = 0; j < 7; j += 1) {
      if (nextBit() === 1) constant |= 1n << BigInt((1 << j) - 1);
    }

    constants.push(constant);
  }

  return constants;
})();

const rotate = (lane: bigint, by: number): bigint =>
  by === 0 ? lane : ((lane << BigInt(by)) | (lane >> BigInt(64 - by))) & MASK;

const at = (state: readonly bigint[], index: number): bigint => state[index] ?? 0n;

function permute(state: bigint[]): void {
  for (const constant of ROUND_CONSTANTS) {
    const columns = [0, 1, 2, 3, 4].map(
      (x) => at(state, x) ^ at(state, x + 5) ^ at(state, x + 10) ^ at(state, x + 15) ^ at(state, x + 20),
    );

    for (let x = 0; x < 5; x += 1) {
      const d = (columns[(x + 4) % 5] ?? 0n) ^ rotate(columns[(x + 1) % 5] ?? 0n, 1);

      for (let y = 0; y < 25; y += 5) state[x + y] = at(state, x + y) ^ d;
    }

    const moved = new Array<bigint>(25).fill(0n);

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(at(state, x + 5 * y), ROTATIONS[x + 5 * y] ?? 0);
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 25; y += 5) {
        state[x + y] = at(moved, x + y) ^ (~at(moved, ((x + 1) % 5) + y) & MASK & at(moved, ((x + 2) % 5) + y));
      }
    }

    state[0] = at(state, 0) ^ constant;
  }
}

/**
 * Keccak-256 of the bytes, as lowercase 0x-prefixed hex, with Ethereum's 0x01 padding rather than SHA-3's 0x06.
 * Written out because the package has no hashing dependency and Node's SHA3-256 is a different function.
 */
export function keccak256(input: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE_BYTES) * RATE_BYTES);

  padded.set(input);
  padded[input.length] = (padded[input.length] ?? 0) ^ 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) ^ 0x80;

  const state = new Array<bigint>(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      let value = 0n;

      for (let byte = 7; byte >= 0; byte -= 1) value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte] ?? 0);

      state[lane] = at(state, lane) ^ value;
    }

    permute(state);
  }

  let hex = '';

  for (let lane = 0; lane < 4; lane += 1) {
    let value = at(state, lane);

    for (let byte = 0; byte < 8; byte += 1) {
      hex += (value & 0xffn).toString(16).padStart(2, '0');
      value >>= 8n;
    }
  }

  return `0x${hex}`;
}

export const keccak256Text = (text: string): string => keccak256(new TextEncoder().encode(text));

/** The first four bytes of the signature's Keccak-256, the Solidity selector. */
export const selectorOf = (signature: string): string => keccak256Text(signature).slice(0, 10);
