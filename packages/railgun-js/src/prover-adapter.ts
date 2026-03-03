/**
 * @module ProverAdapter
 *
 * Adapter that owns snarkjs proving logic and exposes a typed interface
 * for the Rust WASM prover to bind against.
 */

import { readFile } from "node:fs/promises";
import * as snarkjs from "snarkjs";
import { JsProof, ProverAdapter } from "./pkg/railgun_rs";

export interface ArtifactLoader {
  loadWasm(circuitName: string): Promise<Uint8Array>;
  loadZkey(circuitName: string): Promise<Uint8Array>;
}

export class GrothProverAdapter implements ProverAdapter {
  private verify: boolean;
  private artifactCache = new Map<
    string,
    { wasm: Uint8Array; zkey: Uint8Array }
  >();

  constructor(
    private loader: ArtifactLoader,
    options?: { verify?: boolean }
  ) {
    this.verify = options?.verify ?? true;
  }

  async prove(
    circuitName: string,
    inputs: Record<string, string[]>
  ): Promise<JsProof> {
    const bigintInputs: Record<string, bigint[]> = {};
    for (const [key, values] of Object.entries(inputs)) {
      bigintInputs[key] = values.map((v) => BigInt(v));
    }

    const { wasm, zkey } = await this.loadArtifacts(circuitName);

    console.log(`Generating proof for ${circuitName}`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      bigintInputs,
      wasm,
      zkey,
      undefined,
      undefined,
      { singleThread: true }
    );

    if (this.verify) {
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
        pi_a: [proof.pi_a[0]! as `0x${string}`, proof.pi_a[1]! as `0x${string}`],
        pi_b: [
          [proof.pi_b[0]![0]! as `0x${string}`, proof.pi_b[0]![1]! as `0x${string}`],
          [proof.pi_b[1]![0]! as `0x${string}`, proof.pi_b[1]![1]! as `0x${string}`],
        ],
        pi_c: [proof.pi_c[0]! as `0x${string}`, proof.pi_c[1]! as `0x${string}`],
      },
      publicInputs: publicSignals.map((s: string) => `0x${BigInt(s).toString(16)}` as `0x${string}`),
    };
  }

  private async loadArtifacts(
    circuitName: string
  ): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
    const cached = this.artifactCache.get(circuitName);
    if (cached) return cached;

    const [wasm, zkey] = await Promise.all([
      this.loader.loadWasm(circuitName),
      this.loader.loadZkey(circuitName),
    ]);

    const artifacts = { wasm, zkey };
    this.artifactCache.set(circuitName, artifacts);
    return artifacts;
  }
}

export class FsArtifactLoader implements ArtifactLoader {
  constructor(private basePath: string) { }

  async loadWasm(circuitName: string): Promise<Uint8Array> {
    return readFile(`${this.basePath}/${circuitName}.wasm`);
  }

  async loadZkey(circuitName: string): Promise<Uint8Array> {
    return readFile(`${this.basePath}/${circuitName}.zkey`);
  }
}

export class RemoteArtifactLoader implements ArtifactLoader {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async loadWasm(circuitName: string): Promise<Uint8Array> {
    const r = await fetch(`${this.baseUrl}/${circuitName}.wasm`);
    if (!r.ok) throw new Error(`Failed to fetch ${circuitName}.wasm: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async loadZkey(circuitName: string): Promise<Uint8Array> {
    const r = await fetch(`${this.baseUrl}/${circuitName}.zkey`);
    if (!r.ok) throw new Error(`Failed to fetch ${circuitName}.zkey: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}