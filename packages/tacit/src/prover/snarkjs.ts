import { type Groth16Proof } from "../pool/abi";
import { N_PUBLIC, type ProverArtifacts } from "./artifacts";

export type Groth16Result = { proof: Groth16Proof; publicSignals: string[] };

/** Proves one `transact`. The default runs snarkjs on this device; a host can supply any other prover. */
export type TacitProver = { prove(input: Record<string, unknown>): Promise<Groth16Result> };

export type ProverFactory = () => TacitProver | Promise<TacitProver>;

/**
 * Proves with snarkjs. The artifacts are loaded on the first proof and kept. A fresh proof is checked against the
 * verification key before it is returned, so a proving bug fails here and not as a reverted transaction.
 */
export function createSnarkjsProver(args: { artifacts: () => Promise<ProverArtifacts>; singleThread?: boolean }): TacitProver {
  let loaded: Promise<ProverArtifacts> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  // The files are loaded once; a failed load is forgotten so the next proof tries again.
  const artifacts = () => {
    loaded ??= args.artifacts().catch((error) => {
      loaded = null;

      throw error;
    });

    return loaded;
  };

  const prove = async (input: Record<string, unknown>): Promise<Groth16Result> => {
    const { wasm, zkey, vk } = await artifacts();
    const module = await import("snarkjs");
    const snarkjs = module.groth16 ? module : (module as unknown as { default: typeof module }).default;

    try {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasm,
        zkey,
        undefined,
        undefined,
        args.singleThread ? { singleThread: true } : undefined,
      );

      if (publicSignals.length !== N_PUBLIC) throw new Error("tacit: unexpected public signal count");

      if (!(await snarkjs.groth16.verify(vk, publicSignals, proof))) throw new Error("tacit: a fresh proof does not verify");

      return { proof, publicSignals };
    } finally {
      // snarkjs keeps worker threads open between proofs; release them so a host process can exit.
      await (globalThis as { curve_bn128?: { terminate?: () => Promise<void> } }).curve_bn128?.terminate?.();
    }
  };

  // One proof at a time: releasing the worker threads after a proof must not cut short another one that is running.
  return {
    prove(input) {
      const run = queue.then(() => prove(input));

      queue = run.catch(() => undefined);

      return run;
    },
  };
}
