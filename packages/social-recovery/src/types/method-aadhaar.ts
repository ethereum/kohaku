import type { METHOD_AADHAAR_ARTIFACT_ORIGINS, METHOD_AADHAAR_PUBLIC_INPUTS } from '../constants/method-aadhaar';

/** The prover's progress callback, called with the stack's `ProverState` values. */
export type AadhaarProgress = (state: string) => void;

/** The `generateArgs` options the method passes. */
export type AadhaarArgsOptions = {
  readonly qrData: string;
  readonly certificateFile: string;
  readonly nullifierSeed: bigint;
  readonly fieldsToRevealArray: readonly string[];
  readonly signal?: string;
};

/** The circuit's arguments `generateArgs` returns, passed to `prove` untouched. */
export type AadhaarProverArgs = { readonly [name: string]: unknown };

/** A snarkjs Groth16 proof as the stack returns it. */
export type AadhaarGroth16 = {
  readonly pi_a: readonly string[];
  readonly pi_b: readonly (readonly string[])[];
  readonly pi_c: readonly string[];
  readonly protocol?: string;
  readonly curve?: string;
};

/** The stack's `AnonAadhaarProof`. */
export type AadhaarStackProof = {
  readonly groth16Proof: AadhaarGroth16;
  readonly pubkeyHash: string;
  readonly timestamp: string;
  readonly nullifierSeed: string;
  readonly nullifier: string;
  readonly signalHash: string;
  readonly ageAbove18: string;
  readonly gender: string;
  readonly pincode: string;
  readonly state: string;
};

/** What `prove` returns and `verify` takes; the stack reads `proof` alone. */
export type AadhaarPcd = { readonly proof: AadhaarStackProof; readonly [member: string]: unknown };

/**
 * The proving stack the method calls, replaceable by a test double. `prove`
 * receives the page's abort signal, which the installed stack's `prove` does not take.
 */
export type AnonAadhaarStack = {
  readonly generateArgs: (options: AadhaarArgsOptions) => Promise<AadhaarProverArgs>;
  readonly prove: (args: AadhaarProverArgs, onProgress?: AadhaarProgress, signal?: AbortSignal) => Promise<AadhaarPcd>;
  readonly verify: (pcd: AadhaarPcd) => Promise<boolean>;
};

/** Where the circuit's artifacts are, the arguments of the stack's `init`. */
export type AnonAadhaarArtifacts = {
  readonly wasmURL: string;
  readonly zkeyURL: string;
  readonly vkeyURL: string;
  readonly artifactsOrigin: (typeof METHOD_AADHAAR_ARTIFACT_ORIGINS)[number];
};

/** The installed stack's package root, declared here because the package ships its types as raw source. */
export type AadhaarCoreSurface = {
  readonly init: (args: unknown) => Promise<void>;
  readonly generateArgs: (options: unknown) => Promise<AadhaarProverArgs>;
  readonly prove: (args: unknown, onProgress?: AadhaarProgress) => Promise<AadhaarPcd>;
  readonly verify: (pcd: unknown) => Promise<boolean>;
  readonly ArtifactsOrigin: { readonly [name: string]: unknown };
};

/** An injected stack or the installed stack's artifacts, not both; with neither the stack is unavailable. */
export type AnonAadhaarMethodOptions = {
  readonly stack?: AnonAadhaarStack;
  readonly artifacts?: AnonAadhaarArtifacts;
};

/** The seed and the certificate the integrator supplies at enrollment and at every approval. */
export type AadhaarParams = {
  readonly nullifierSeed: bigint;
  readonly certificateFile: string;
};

/** What the page supplies to a proving call. */
export type AadhaarMaterial = {
  readonly qrData: string;
  readonly onProgress?: AadhaarProgress;
  readonly signal?: AbortSignal;
};

/** One public input's name. */
export type AadhaarPublicInput = (typeof METHOD_AADHAAR_PUBLIC_INPUTS)[number];

/** The decoded config. */
export type AadhaarConfig = {
  readonly nullifier: bigint;
  readonly nullifierSeed: bigint;
};

/** One Groth16 coordinate pair. */
export type AadhaarPair = readonly [bigint, bigint];

/** The nine public inputs as the proof ABI's fixed-length tuple. */
export type AadhaarNineWords = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

/** The decoded proof, its `b` pairs in the verifier's order. */
export type AadhaarProof = {
  readonly a: AadhaarPair;
  readonly b: readonly [AadhaarPair, AadhaarPair];
  readonly c: AadhaarPair;
  readonly inputs: readonly bigint[];
};
