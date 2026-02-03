import decompress from 'brotli/decompress';
import artifacts from "./artifacts.json";

export type Protocols = "groth16";
export type Curves = "bn128";

export type VKey = {
  protocol: Protocols;
  curve: Curves;
  nPublic: number;
  vk_alpha_1: [string, string];
  vk_beta_2: [[string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string]];
  vk_alphabeta_12: string[][];
  IC: string[][];
}

export type Artifact = {
  zkey: Uint8Array;
  wasm: Uint8Array;
  vkey: VKey;
}

export type ArtifactConfig = {
  nullifiers: number;
  commitments: number;
}

const cache: Record<number, Record<number, Artifact>> = {};

export type RGCircuitGetterFn = (path: string) => Promise<Buffer>;

export async function getArtifact(nullifiers: number, commitments: number, get: RGCircuitGetterFn): Promise<Artifact> {
  if (!cache[nullifiers]) {
    cache[nullifiers] = [];
  }

  if (!cache[nullifiers][commitments]) {
    cache[nullifiers][commitments] = {
      zkey: decompress(
        await get(`${nullifiers}x${commitments}/zkey.br`)
      ),
      wasm: decompress(
        await get(`${nullifiers}x${commitments}/wasm.br`)
      ),
      vkey: JSON.parse((await get(`${nullifiers}x${commitments}/vkey.json`)).toString('utf-8')),
    };
  }

  return cache[nullifiers][commitments];
}

export async function getVKey(nullifiers: number, commitments: number, get: RGCircuitGetterFn): Promise<VKey> {
  if (!cache[nullifiers] || !cache[nullifiers][commitments]) {
    return JSON.parse((await get(`${nullifiers}x${commitments}/vkey.json`)).toString('utf-8'));
  }

  return cache[nullifiers][commitments].vkey;
}

export function listArtifacts(): ArtifactConfig[] {
  return artifacts;
}
