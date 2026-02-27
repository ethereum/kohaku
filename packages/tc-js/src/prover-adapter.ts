/**
 * @module ProverAdapter
 *
 * Adapter that owns snarkjs proving logic and exposes a typed interface
 * for the Rust WASM prover to bind against.
 *
 * Rust calls: proveTransact()
 */

import { readFile } from "node:fs/promises";
import circuit from "../../../artifacts/tc/tornado.json" with { type: "json" };
import buildGroth16 from "@tornado/websnark/src/groth16";
import * as websnarkUtils from "@tornado/websnark/src/utils";
import { JsProofResponse, JsProver } from "./pkg/tc_rs.js";

/** Create a JsProver from config. */
export function createProver(): JsProver {
  const adapter = new ProverAdapter();
  return new JsProver(adapter);
}

class ProverAdapter {
  private groth16Promise: Promise<any>;

  constructor() {
    this.groth16Promise = buildGroth16();
  }

  async prove(
    inputs: Record<string, string[]>
  ): Promise<JsProofResponse> {
    console.log("Starting proof generation");

    const groth16 = await this.groth16Promise;

    let bigintInputs: Record<string, bigint | bigint[]> = {};
    for (const [key, values] of Object.entries(inputs)) {
      bigintInputs[key] = values.map((v) => BigInt(v));
    }

    for (const [key, values] of Object.entries(bigintInputs)) {
      if (Array.isArray(values) && values.length == 1) {
        bigintInputs[key] = values[0]!;
      }
    }

    console.log("Loading proving key");
    const provingKeyBuffer = await readFile(
      new URL("../../../artifacts/tc/tornadoProvingKey.bin", import.meta.url)
    );

    console.log("Generating proof");
    const { pi_a, pi_b, pi_c, publicSignals } =
      await websnarkUtils.genWitnessAndProve(
        groth16,
        bigintInputs,
        circuit,
        provingKeyBuffer.buffer
      );

    return {
      proof: {
        pi_a: [pi_a[0]!, pi_a[1]!],
        pi_b: [
          [pi_b[0]![0]!, pi_b[0]![1]!],
          [pi_b[1]![0]!, pi_b[1]![1]!],
        ],
        pi_c: [pi_c[0]!, pi_c[1]!],
      },
      publicInputs: publicSignals.map((s: string) => '0x' + BigInt(s).toString(16)),
    };
  }
}
