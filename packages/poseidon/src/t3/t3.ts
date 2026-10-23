import { CP, C0, CF_PRE, CF_POS, M, P, S, NINV, MASK, p, R2 } from "./constants.ts";

const N_ROUNDS_FULL_PRE = 4;
const N_ROUNDS_PARTIAL = 57;
const N_ROUNDS_FULL_POST = 4;


// This functino asumes that the resulting r is overflows p once at max.
// For this to be true x must be lest that p R ~ 5.28 p^2. This margin allow us
// to not reduce everythin everiwhere if we are going to reduce in the next operation
function redc(x: bigint): bigint {
  const q = ((x & MASK) * NINV) & MASK;
  const r = (x + q * p) >> 256n;
  return r >= p ? r - p : r;
}

// redc(x R^2) = xR
function toMontgomery(x: bigint): bigint {
  return redc((x < p ? x : x % p) * R2);
}

function pow5(x: bigint): bigint {
  const x2 = redc(x * x);
  const x4 = redc(x2 * x2);
  return redc(x * x4)
}

function add(a: bigint, b: bigint): bigint {
  const r = a + b;
  return r >= p ? r - p : r;
}

class State {
    private s: bigint[];

    constructor(a: bigint, b:bigint) {
        this.s = [0n, toMontgomery(a), toMontgomery(b)]
    }

    ARC(c: bigint[]): void {
        // We can avoid % p here and asume that after ARC
        // s is bounded by 2p
        this.s[0] = this.s[0] + c[0]
        this.s[1] = this.s[1] + c[1]
        this.s[2] = this.s[2] + c[2]
    }

    sbox(): void {
        this.s[0] = pow5(this.s[0])
        this.s[1] = pow5(this.s[1])
        this.s[2] = pow5(this.s[2])
    }

    mixRow(w: bigint[]): bigint {
        // After ARC s < 2p so the dot product is bounded by 
        // (w[0] + w[1] + w[2]) 2p for our matrix M and P this is about
        // 2.65 p^2 < pR ~ 5.29 p^2. We can safelly reduce the three podructs at once.
        // This resulted in a speed up of 25%
        return redc(this.s[0] * w[0] + this.s[1] * w[1] + this.s[2] * w[2]);
    }

    mix(matrix: bigint[][]): void {
        const outs = this.s.map((_,i) => this.mixRow(matrix[i]));
        this.s = outs
    }

    full(constants: bigint[], matrix: bigint[][]): void {
        this.sbox();
        this.ARC(constants);
        this.mix(matrix);
    }

    partial(constant: bigint, sRound: bigint[]): void {
        this.s[0] = pow5(this.s[0]) + constant;
        const out0 = this.mixRow([sRound[0], sRound[1], sRound[2]]) ;

        this.s[1] = add(this.s[1], redc(this.s[0] * sRound[3]));
        this.s[2] = add(this.s[2], redc(this.s[0] * sRound[4]));
        this.s[0] = out0;
    }
}


export function hash(in0: bigint, in1: bigint): bigint {
    if (in0 < 0n || in1 < 0n) throw new RangeError("inputs must be non-negative");

    let state = new State(in0, in1);
    state.ARC(C0);

    // First full (4) rounds. The first 3 are mixed with M; the last one with P.
    for (let round = 0; round < N_ROUNDS_FULL_PRE; round++) {
        state.full(CF_PRE[round], round < 3 ? M : P);
    }

    // Partial rounds
    for (let round = 0; round < N_ROUNDS_PARTIAL; round++) {
        state.partial(CP[round], S[round])
    }

    // Last full (4) rounds. All are mixed with M; the very last one has no ARC round.
    // The output drops s[1] and s[2], so the last mix computes only row 0.
    for (let round = 0; round < N_ROUNDS_FULL_POST - 1; round++) {
        state.full(CF_POS[round], M )
    }

    state.sbox();

    // redc(x R) = x.
    return redc(state.mixRow(M[0]))
}
