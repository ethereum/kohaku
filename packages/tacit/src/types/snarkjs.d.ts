// snarkjs ships no types; this is the part of it the prover uses.
declare module "snarkjs" {
  type Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string,
      logger?: unknown,
      wtnsOptions?: unknown,
      proverOptions?: { singleThread?: boolean },
    ): Promise<{ proof: Proof; publicSignals: string[] }>;
    verify(vk: unknown, publicSignals: string[], proof: Proof, logger?: unknown): Promise<boolean>;
  };
}
