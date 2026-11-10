import { poseidonT3 } from "@kohaku-eth/poseidon";

// Given the array of leaves `prev` computes the upper level parents of the slice [from, to).
// if `prev` is the whole level this can be use to compute the next level. It is writen in this
// way to be paralellizable.
export function hashRange(prev: bigint[], from: number, to: number): bigint[] {
  const out = new Array<bigint>(to - from);

  for (let i = from; i < to; i++) {
    const right = 2 * i + 1;

    out[i - from] = right < prev.length ? poseidonT3(prev[2 * i], prev[right]) : prev[2 * i];
  }

  return out;
}
