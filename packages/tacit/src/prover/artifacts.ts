import { type Network } from "@kohaku-eth/plugins";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { TacitArtifacts } from "../config";
import { be } from "../crypto/bytes";

/** The ceremony's proving files, each already checked against its pin. */
export type ProverArtifacts = { wasm: Uint8Array; zkey: Uint8Array; vk: VerifyingKey };

/** A Groth16 verification key in snarkjs's JSON form. */
export type VerifyingKey = {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
};

export const N_PUBLIC = 11;

/** SHA-256 over alpha1 ‖ beta2 ‖ gamma2 ‖ delta2 ‖ IC as 32-byte big-endian limbs: the pin on a key's content. */
export function vkHash(vk: VerifyingKey): string {
  if (vk.protocol !== "groth16" || vk.curve !== "bn128" || Number(vk.nPublic) !== N_PUBLIC) {
    throw new Error("tacit: not the pool's Groth16 verification key");
  }

  const limbs = [...vk.vk_alpha_1.slice(0, 2)];

  for (const g of [vk.vk_beta_2, vk.vk_gamma_2, vk.vk_delta_2]) limbs.push(g[0]![0]!, g[0]![1]!, g[1]![0]!, g[1]![1]!);

  for (const point of vk.IC) limbs.push(point[0]!, point[1]!);

  const buffer = new Uint8Array(limbs.length * 32);

  limbs.forEach((limb, i) => buffer.set(be(BigInt(limb), 32), 32 * i));

  return bytesToHex(sha256(buffer));
}

async function fetchChecked(network: Network, urls: readonly string[], accept: (bytes: Uint8Array) => boolean, what: string): Promise<Uint8Array> {
  const failures: string[] = [];

  for (const url of urls) {
    try {
      const response = await network.fetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = new Uint8Array(await response.arrayBuffer());

      if (accept(bytes)) return bytes;

      failures.push(`${url}: does not match the pin`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`tacit: could not load ${what}: ${failures.join("; ")}`);
}

/** Downloads the proving files (about 33 MB) and refuses any copy whose hash differs from the ceremony's. */
export async function loadArtifacts(network: Network): Promise<ProverArtifacts> {
  const sha = (expected: string) => (bytes: Uint8Array) => bytesToHex(sha256(bytes)) === expected;
  const [wasm, zkey, vkBytes] = await Promise.all([
    fetchChecked(network, TacitArtifacts.wasm.urls, sha(TacitArtifacts.wasm.sha256), "the circuit's witness program"),
    fetchChecked(network, TacitArtifacts.zkey.urls, sha(TacitArtifacts.zkey.sha256), "the proving key"),
    fetchChecked(
      network,
      TacitArtifacts.vk.urls,
      (bytes) => {
        try {
          return vkHash(JSON.parse(new TextDecoder().decode(bytes)) as VerifyingKey) === TacitArtifacts.vk.hash;
        } catch {
          return false;
        }
      },
      "the verification key",
    ),
  ]);

  return { wasm, zkey, vk: JSON.parse(new TextDecoder().decode(vkBytes)) as VerifyingKey };
}
