import { hash as poseidonT3 } from "./t3/t3.ts";

export { poseidonT3 };

// Hash function per arity (state width t = arity + 1).
// Only T3 (2 inputs) is implemented for now.
export interface Hashers {
    2: (in0: bigint, in1: bigint) => bigint;
}

export type Arity = keyof Hashers;

const HASHERS: Hashers = {
    2: poseidonT3,
};

// Returns the Poseidon hash function for the given arity.
export function createPoseidon<A extends Arity>(arity: A): Hashers[A] {
    const hasher = HASHERS[arity];
    if (!hasher) throw new RangeError(`unsupported arity: ${arity}`);
    return hasher;
}

// Selects the Poseidon instance by the number of inputs at runtime.
export function poseidon(inputs: readonly bigint[]): bigint {
    switch (inputs.length) {
        case 2:
            return poseidonT3(inputs[0], inputs[1]);
        default:
            throw new RangeError(`unsupported arity: ${inputs.length} (supported: 2)`);
    }
}
