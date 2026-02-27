import buildGroth16 from "@tornado/websnark/src/groth16";
import * as websnarkUtils from "@tornado/websnark/src/utils";
import { JsProof, ProverAdapter } from "./pkg/tc_rs.js";
import { ArtifactLoader } from "./artifact-loader.js";

export class TornadoClassicProver implements ProverAdapter {
  private groth16Promise: Promise<any>;

  constructor(private artifactLoader: ArtifactLoader) {
    this.groth16Promise = buildGroth16();
  }

  async prove(
    circuitName: string,
    inputs: Record<string, `0x${string}`[]>
  ): Promise<JsProof> {
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

    console.log("Loading artifacts");
    const { circuit, provingKey } = await this.artifactLoader.load();

    console.log("Generating proof");
    const { pi_a, pi_b, pi_c, publicSignals } =
      await websnarkUtils.genWitnessAndProve(
        groth16,
        bigintInputs,
        circuit,
        provingKey
      );

    return {
      proof: {
        pi_a: [pi_a[0]! as `0x${string}`, pi_a[1]! as `0x${string}`],
        pi_b: [
          [pi_b[0]![0]! as `0x${string}`, pi_b[0]![1]! as `0x${string}`],
          [pi_b[1]![0]! as `0x${string}`, pi_b[1]![1]! as `0x${string}`],
        ],
        pi_c: [pi_c[0]! as `0x${string}`, pi_c[1]! as `0x${string}`],
      },
      publicInputs: publicSignals.map((s: string) => `0x${BigInt(s).toString(16)}` as `0x${string}`),
    };
  }
}
