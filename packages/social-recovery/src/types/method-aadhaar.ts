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
  readonly verify: (pcd: AadhaarPcd, testMode?: boolean) => Promise<boolean>;
  /**
   * The QR's signing time in Unix seconds, read before proving, or `undefined` where it cannot be read; the default stack provides it.
   * `replyFrom` refuses a QR older than the config's window by more than `METHOD_AADHAAR_SIGNED_AT_SLACK` without proving.
   */
  readonly signedAt?: (qrData: string) => Promise<bigint | undefined>;
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
  readonly verify: (pcd: unknown, testMode?: boolean) => Promise<boolean>;
  readonly ArtifactsOrigin: { readonly [name: string]: unknown };
  /** The decimal hashes of the peer's two keys: UIDAI's 2021 key, which only the peer's `verify` checks, and its test key, the one the default stack refuses locally outside test mode. */
  readonly productionPublicKeyHash: string;
  readonly testPublicKeyHash: string;
  /** The QR's signing time to the hour, from the raw bytes `decompressByteArray` returns; the three are optional, a peer without them leaves `signedAt` undefined. */
  readonly timestampToUTCUnix?: (rawData: Uint8Array) => number;
  readonly decompressByteArray?: (byteArray: Uint8Array) => Uint8Array;
  readonly convertBigIntToByteArray?: (bigInt: bigint) => Uint8Array;
};

/** An injected stack or the installed stack's artifacts, not both; with neither the installed stack reads `METHOD_AADHAAR_DEFAULT_ARTIFACTS`. */
export type AnonAadhaarMethodOptions = {
  readonly stack?: AnonAadhaarStack;
  /**
   * Where the installed stack reads the circuit's files: a bucket record, `METHOD_AADHAAR_BUCKET_CHUNKED` (the default) or
   * `METHOD_AADHAAR_BUCKET_SERVER`, or the integrator's own URLs or paths. The SDK hosts no file and checks only that the URLs are
   * non-empty strings and the origin is known. `chunked` runs in a browser only, `local` in Node only, where each URL is a file
   * path; a browser caller holding the files passes `URL.createObjectURL(file)` for each under `server`. The peer's `init` is
   * page-global: the stack initialises once, on first use, and the last `init` on the page sets the files every stack proves with.
   */
  readonly artifacts?: AnonAadhaarArtifacts;
  /**
   * Makes the local verdict check the proof against anon-aadhaar's test key, so a test QR verifies; off by default.
   * The deployed module checks its own trusted key, so a test proof satisfies only a module whose trusted key is the test key's hash.
   */
  readonly testMode?: boolean;
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
  /** The greatest age, in seconds, of a QR an approval accepts. */
  readonly freshnessWindow: bigint;
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
