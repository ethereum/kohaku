declare type Optional<T> = T | undefined;

// Webpack global for non-webpack requires
declare const __non_webpack_require__: typeof require | undefined;

// Polyfill __dirname for browser environments
// This is set by webpack.ts to enable npm packages that use __dirname
declare const __dirname: string;

declare module '@railgun-community/circomlibjs' {
  export type Signature = {
    R8: [bigint, bigint];
    S: bigint;
  };
  export namespace eddsa {
    export function verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    export function signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    export function prv2pub(prv: Buffer): [bigint, bigint];
  }
  export namespace babyjub {
    export function packPoint(point: [bigint, bigint]): Buffer;
    export function unpackPoint(buffer: Buffer): [bigint, bigint];
  }
  export function poseidon(inputs: bigint[]): bigint;
}

declare type Artifact = {
  zkey: ArrayLike<number>;
  wasm: Optional<ArrayLike<number>>;
  dat: Optional<ArrayLike<number>>;
  vkey: object;
};

declare module 'railgun-community-circuit-artifacts' {
  type ArtifactListMetadata = {
    nullifiers: number;
    commitments: number;
  }[];

  export function getArtifact(nullifiers: number, commitments: number): Artifact;

  export function getVKey(nullifiers: number, commitments: number): string;

  export function listArtifacts(): ArtifactListMetadata;
}

declare module 'snarkjs' {
  export type Protocols = 'groth16';
  export type Curves = 'bn128';

  export interface SnarkjsProof {
    pi_a: (string | bigint)[];
    pi_b: (string | bigint)[][];
    pi_c: (string | bigint)[];
    protocol: Protocols;
  }

  export type PublicSignals = (string | bigint)[];

  export interface SNARK {
    proof: SnarkjsProof;
    publicSignals: PublicSignals;
  }

  export interface VKey {
    protocol: Protocols;
    curve: Curves;
    nPublic: number;
    vk_alpha_1: (string | bigint)[];
    vk_beta_2: (string | bigint)[][];
    vk_gamma_2: (string | bigint)[][];
    vk_delta_2: (string | bigint)[][];
    vk_alphabeta_12: (string | bigint)[][];
    IC: (string | bigint)[][];
  }

  namespace groth16 {
    function fullProve(
      inputs: unknown,
      wasm: Uint8Array,
      zkey: Uint8Array,
      logger?: unknown,
    ): Promise<SNARK>;
    function verify(
      vkVerifier: VKey,
      publicSignals: PublicSignals,
      proof: SnarkjsProof,
      logger?: unknown,
    ): Promise<boolean>;
  }
}
