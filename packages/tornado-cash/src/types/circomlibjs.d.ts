declare module 'circomlibjs' {
  interface BabyJub {
    F: { toObject(x: unknown): bigint };
    unpackPoint(point: unknown): [unknown, unknown];
  }

  interface PedersenHash {
    hash(data: Uint8Array, options?: { baseHash: 'blake' | 'blake2b' }): unknown;
  }

  interface MimcSponge {
    F: { toString(x: unknown): string };
    multiHash(inputs: bigint[], key?: bigint, numOutputs?: number): unknown;
  }

  export function buildBabyjub(): Promise<BabyJub>;
  export function buildPedersenHash(): Promise<PedersenHash>;
  export function buildMimcSponge(): Promise<MimcSponge>;
}
