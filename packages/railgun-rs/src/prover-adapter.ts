/**
 * @module ProverAdapter
 *
 * Adapter that owns snarkjs proving logic and exposes a typed interface
 * for the Rust WASM prover to bind against.
 *
 * Rust calls: proveTransact(), provePoi()
 */

import { readFile } from "node:fs/promises";
import * as snarkjs from "snarkjs";
import { JsProofResponse, JsProver } from "./pkg/railgun_rs.js";

export interface ArtifactPaths {
  wasmPath: string;
  zkeyPath: string;
}

export interface ProverConfig {
  /** Base path to circuit artifacts. */
  artifactsPath: string;
  /** Custom artifact resolver. */
  resolveArtifacts?: (circuitName: string, basePath: string) => ArtifactPaths;
  /** Verify proofs after generation (default: true). */
  verify?: boolean;
}

/** Create a JsProver from config. */
export function createProver(config: ProverConfig): JsProver {
  const adapter = new ProverAdapter(config);
  return new JsProver(adapter);
}

/**
 * Owns snarkjs artifact loading / caching / proving.
 * Passed into Rust via `JsProver::new()`.
 */
export class ProverAdapter {
  private config: Required<Pick<ProverConfig, "artifactsPath" | "verify">> & {
    resolveArtifacts: (circuitName: string, basePath: string) => ArtifactPaths;
  };

  private artifactCache = new Map<
    string,
    { wasm: Uint8Array; zkey: Uint8Array }
  >();

  constructor(config: ProverConfig) {
    this.config = {
      artifactsPath: config.artifactsPath,
      verify: config.verify ?? true,
      resolveArtifacts: config.resolveArtifacts ?? ProverAdapter.defaultResolveArtifacts,
    };
  }

  async proveTransact(
    circuitName: string,
    inputs: Record<string, string[]>
  ): Promise<JsProofResponse> {
    return this.prove(circuitName, inputs);
  }

  async provePoi(
    circuitName: string,
    inputs: Record<string, string[]>
  ): Promise<JsProofResponse> {
    return this.prove(circuitName, inputs);
  }

  private async prove(
    circuitName: string,
    inputs: Record<string, string[]>
  ): Promise<JsProofResponse> {
    const { wasmPath, zkeyPath } = this.config.resolveArtifacts(
      circuitName,
      this.config.artifactsPath
    );

    const bigintInputs: Record<string, bigint[]> = {};
    for (const [key, values] of Object.entries(inputs)) {
      bigintInputs[key] = values.map((v) => BigInt(v));
    }

    const { wasm, zkey } = await this.loadArtifacts(wasmPath, zkeyPath);

    console.log(`Generating proof for ${circuitName}`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      bigintInputs,
      wasm,
      zkey,
      undefined,
      undefined,
      { singleThread: true }
    );

    if (this.config.verify) {
      console.log(`Verifying proof for ${circuitName}`);
      const vkey = await snarkjs.zKey.exportVerificationKey(zkey);
      const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      if (!valid) {
        throw new Error(`Proof verification failed for ${circuitName}`);
      }
      console.log("Proof verified");
    }

    return {
      proof: {
        pi_a: [proof.pi_a[0]!, proof.pi_a[1]!],
        pi_b: [
          [proof.pi_b[0]![0]!, proof.pi_b[0]![1]!],
          [proof.pi_b[1]![0]!, proof.pi_b[1]![1]!],
        ],
        pi_c: [proof.pi_c[0]!, proof.pi_c[1]!],
      },
      publicInputs: publicSignals.map((s: string) => '0x' + BigInt(s).toString(16)),
    };
  }

  private async loadArtifacts(
    wasmPath: string,
    zkeyPath: string
  ): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
    const cacheKey = `${wasmPath}:${zkeyPath}`;
    const cached = this.artifactCache.get(cacheKey);
    if (cached) return cached;

    const [wasm, zkey] = await Promise.all([
      readFile(wasmPath),
      readFile(zkeyPath),
    ]);

    const artifacts = { wasm, zkey };
    this.artifactCache.set(cacheKey, artifacts);
    return artifacts;
  }

  private static defaultResolveArtifacts(
    circuitName: string,
    basePath: string
  ): ArtifactPaths {
    const [circuitType, size] = circuitName.split("/");
    const folder = circuitType === "transact" ? "railgun" : "ppoi";
    return {
      wasmPath: `${basePath}/${folder}/${size}.wasm`,
      zkeyPath: `${basePath}/${folder}/${size}.zkey`,
    };
  }
}

