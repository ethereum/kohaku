import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";
import { poseidon5 } from "poseidon-lite/poseidon5";
import { poseidon7 } from "poseidon-lite/poseidon7";

type PoseidonFn = (inputs: bigint[]) => bigint;

// Only the widths the pool uses: tree nodes (2), nullifiers (3), note keys and leaves (4), signatures (5) and
// the transaction message (7).
const WIDTHS: Record<number, PoseidonFn> = {
  2: poseidon2,
  3: poseidon3,
  4: poseidon4,
  5: poseidon5,
  7: poseidon7,
};

/** circomlib-compatible Poseidon over BN254. */
export function poseidon(inputs: readonly bigint[]): bigint {
  const hash = WIDTHS[inputs.length];

  if (!hash) throw new RangeError(`tacit: no Poseidon for ${inputs.length} inputs`);

  return hash([...inputs]);
}
