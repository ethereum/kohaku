import type { METHOD_AADHAAR_ARTIFACT_ORIGINS, METHOD_AADHAAR_PUBLIC_INPUTS } from '../constants/method-aadhaar';
import type { Hex } from '../interfaces';

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

/** The proving stack the method calls, replaceable by a test double. */
export type AnonAadhaarStack = {
  readonly generateArgs: (options: AadhaarArgsOptions) => Promise<AadhaarProverArgs>;
  /**
   * Receives the page's progress, which forwards no state after the signal aborts or the call settles, and the page's abort
   * signal. The installed stack reads the signal only to drop a proof still waiting for the peer, so once its download and
   * proving start they run on after an abort; an injected stack may stop on it.
   */
  readonly prove: (args: AadhaarProverArgs, onProgress?: AadhaarProgress, signal?: AbortSignal) => Promise<AadhaarPcd>;
  readonly verify: (pcd: AadhaarPcd, testMode?: boolean) => Promise<boolean>;
  /**
   * The QR's signing time in Unix seconds, read before proving, or `undefined` where it cannot be read; the default stack provides it.
   * `replyFrom` refuses a QR older than the config's window by more than `METHOD_AADHAAR_SIGNED_AT_SLACK` without proving.
   */
  readonly signedAt?: (qrData: string) => Promise<bigint | undefined>;
};

/** Where the circuit's artifacts are, the arguments of the stack's `init`; stacks over different artifacts on one page take turns on the peer. */
export type AnonAadhaarArtifacts = {
  readonly wasmURL: string;
  readonly zkeyURL: string;
  readonly vkeyURL: string;
  readonly artifactsOrigin: (typeof METHOD_AADHAAR_ARTIFACT_ORIGINS)[number];
};

/** The sha256 of an artifact set's three files, as `0x`-prefixed hex. */
export type AadhaarArtifactHashes = { readonly wasm: Hex; readonly zkey: Hex; readonly vkey: Hex };

/** The checked wasm and vkey, behind their object URLs. */
export type PinnedPair = Pick<AnonAadhaarArtifacts, 'wasmURL' | 'vkeyURL'>;

/** The hashes a pair is checked against. */
export type PinnedHashes = Pick<AadhaarArtifactHashes, 'wasm' | 'vkey'>;

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

/** What the peer's `init` takes: the artifacts' URLs, with the origin as the peer's own value. */
export type AadhaarInitArgument = Omit<AnonAadhaarArtifacts, 'artifactsOrigin'> & { readonly artifactsOrigin: number };

/** The loaded peer and the argument its `init` takes for one stack's files. */
export type AadhaarLoadedPeer = { readonly core: AadhaarCoreSurface; readonly argument: AadhaarInitArgument };

/** An injected stack or the installed stack's artifacts, not both; with neither the installed stack reads `METHOD_AADHAAR_DEFAULT_ARTIFACTS`. */
export type AnonAadhaarMethodOptions = {
  readonly stack?: AnonAadhaarStack;
  /**
   * Where the installed stack reads the circuit's files: a bucket record, `METHOD_AADHAAR_BUCKET_CHUNKED` (the default) or
   * `METHOD_AADHAAR_BUCKET_SERVER`, or the integrator's own URLs or paths. The SDK hosts no file and checks that the URLs are
   * non-empty strings and the origin is known; where the wasm and vkey URLs are the bucket's own, the installed stack fetches both once
   * per page, checks them against `METHOD_AADHAAR_BUCKET_SHA256` and hands them to the peer as object URLs, which every later stack over
   * them reuses and nothing revokes, and it fetches no integrator URL. `chunked` runs in a browser only, `local` in Node only, where each
   * URL is a file path; a browser caller holding the files passes `URL.createObjectURL(file)` for each under `server`. The peer's `init`
   * is page-global, so two stacks with different files on one page take turns on the peer: before a call, a stack whose files the peer
   * does not hold waits for every call in flight under the files it holds to settle, then calls `init` with its own.
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
  /** The method module's trusted key as the integrator read it, where given; a proof under another issuer key is `material-untrusted`. */
  readonly trustedKey?: bigint;
};

/** What the page supplies to a proving call. */
export type AadhaarMaterial = {
  readonly qrData: string;
  readonly onProgress?: AadhaarProgress;
  /**
   * Aborting settles the call `device-refused` at once, with no proof or config, and no progress is forwarded after the signal
   * aborts or the call settles. The SDK starts no worker: the installed stack's download and proving run on, holding their memory
   * and CPU until they end, and a call started meanwhile over the same files proves alongside them, one over other files after them;
   * an injected stack receives the signal and may stop its own work.
   */
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
