import type { DeviceBinding, ReplyFailure } from '../interfaces/records';

/** The two vector files this implementation's tests replay. */
export const METHOD_AADHAAR_VECTOR_FILES = Object.freeze(['method-aadhaar-config.json', 'method-aadhaar-proof.json'] as const);

/** The config's ABI layout. */
export const METHOD_AADHAAR_CONFIG_ABI = [
  { name: 'nullifier', type: 'uint256' },
  { name: 'nullifierSeed', type: 'uint256' },
  { name: 'freshnessWindow', type: 'uint256' },
] as const;

/** The config's field names, in the layout's order. */
export const METHOD_AADHAAR_CONFIG_FIELDS = Object.freeze(['nullifier', 'nullifierSeed', 'freshnessWindow'] as const);

/** The config's exact length in bytes. */
export const METHOD_AADHAAR_CONFIG_BYTES = 96;

/** The freshness window `configFrom` writes into every config: 24 hours, in seconds. */
export const METHOD_AADHAAR_FRESHNESS_WINDOW = 86400n;

/** The shortest freshness window, in seconds, a config may carry; a shorter one is judged `rejected`. */
export const METHOD_AADHAAR_MIN_FRESHNESS_WINDOW = 3600n;

/** The proof's ABI layout, the Groth16 verifier's `verifyProof` arguments. */
export const METHOD_AADHAAR_PROOF_ABI = [
  { name: 'a', type: 'uint256[2]' },
  { name: 'b', type: 'uint256[2][2]' },
  { name: 'c', type: 'uint256[2]' },
  { name: 'inputs', type: 'uint256[9]' },
] as const;

/** The proof's field names, in the layout's order. */
export const METHOD_AADHAAR_PROOF_FIELDS = Object.freeze(['a', 'b', 'c', 'inputs'] as const);

/** The proof's exact length in bytes. */
export const METHOD_AADHAAR_PROOF_BYTES = 544;

/** The words in one Groth16 coordinate pair. */
export const METHOD_AADHAAR_PAIR_WORDS = 2;

/** The pairs in the Groth16 `b` point. */
export const METHOD_AADHAAR_B_PAIRS = 2;

/** The public inputs by position, in the circuit's order. */
export const METHOD_AADHAAR_PUBLIC_INPUTS = Object.freeze([
  'pubkeyHash',
  'nullifier',
  'timestamp',
  'ageAbove18',
  'gender',
  'pincode',
  'state',
  'nullifierSeed',
  'signalHash',
] as const);

/** The number of public inputs. */
export const METHOD_AADHAAR_PUBLIC_INPUT_COUNT = METHOD_AADHAAR_PUBLIC_INPUTS.length;

/** The public inputs that disclose a field of the card; a proof the method accepts carries zero in each. */
export const METHOD_AADHAAR_DISCLOSURE_INPUTS = Object.freeze(['ageAbove18', 'gender', 'pincode', 'state'] as const);

/** The milliseconds in one second, the system clock's unit. */
export const METHOD_AADHAAR_MILLISECONDS_PER_SECOND = 1000;

/** The width in bits of every config and proof word. */
export const METHOD_AADHAAR_WORD_BITS = 256;

/**
 * The circuit's scalar field; a seed at or above it would enter the circuit
 * reduced and prove a seed other than the one the config records.
 */
export const METHOD_AADHAAR_SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The right shift that brings keccak256 of the digest inside the circuit's field. */
export const METHOD_AADHAAR_SIGNAL_HASH_SHIFT = 3n;

/** The projective coordinate snarkjs appends to a G1 point. */
export const METHOD_AADHAAR_G1_PROJECTIVE = '1';

/** The projective coordinate snarkjs appends to a G2 point. */
export const METHOD_AADHAAR_G2_PROJECTIVE = Object.freeze(['1', '0'] as const);

/** The protocol and curve snarkjs names on a Groth16 proof. */
export const METHOD_AADHAAR_GROTH16_PROTOCOL = 'groth16';
export const METHOD_AADHAAR_GROTH16_CURVE = 'bn128';

/** The DOM event a signal fires on abort. */
export const METHOD_AADHAAR_ABORT_EVENT = 'abort';

/** The signal's flag and the calls this module uses on it. */
export const METHOD_AADHAAR_SIGNAL_FLAG = 'aborted';
export const METHOD_AADHAAR_SIGNAL_CALLS = Object.freeze(['addEventListener', 'removeEventListener'] as const);

/** The proving stack's package and the one version this build is pinned to. */
export const METHOD_AADHAAR_STACK_PACKAGE = '@anon-aadhaar/core';
export const METHOD_AADHAAR_STACK_VERSION = '2.4.3';

/** The calls the loaded stack must expose as functions. */
export const METHOD_AADHAAR_STACK_CALLS = Object.freeze(['init', 'generateArgs', 'prove', 'verify'] as const);

/** The stack's member naming its artifact origins, and the member a CommonJS package's exports may arrive under. */
export const METHOD_AADHAAR_STACK_ORIGINS_MEMBER = 'ArtifactsOrigin';
export const METHOD_AADHAAR_STACK_DEFAULT_MEMBER = 'default';

/** The artifact origins the stack's `ArtifactsOrigin` names. */
export const METHOD_AADHAAR_ARTIFACT_ORIGINS = Object.freeze(['server', 'local', 'chunked'] as const);

/** Where the proof is made: a prover running in the approver's browser. */
export const METHOD_AADHAAR_DEVICE_BINDING: DeviceBinding = 'in-browser-prover';

/** The typed failures the method answers, frozen so no caller can alter them. */
export const METHOD_AADHAAR_MATERIAL_REJECTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'material-rejected' });
export const METHOD_AADHAAR_DEVICE_REFUSED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'device-refused' });
export const METHOD_AADHAAR_DEVICE_UNAVAILABLE: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'device-unavailable' });
export const METHOD_AADHAAR_REQUEST_UNSUPPORTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'request-unsupported' });

/** The device kind `describe` reports. */
export const METHOD_AADHAAR_DEVICE_KIND = 'in-page-prover';

/** Facts about the approver's device and the stack's standing. */
export const METHOD_AADHAAR_DEVICE_FACTS = Object.freeze({
  kind: METHOD_AADHAAR_DEVICE_KIND,
  prover: 'in-browser',
  qrImageLeavesDevice: false,
  provingTakes: 'tens-of-seconds',
  stack: METHOD_AADHAAR_STACK_PACKAGE,
  stackVersion: METHOD_AADHAAR_STACK_VERSION,
  stackStanding: 'pinned-only',
} as const);

/** The enrollment parameters the integrator passes, and the input member carrying the certificate. */
export const METHOD_AADHAAR_SEED_PARAM = 'nullifierSeed';
export const METHOD_AADHAAR_CERTIFICATE_PARAM = 'issuerCertificate';
export const METHOD_AADHAAR_CERTIFICATE_INPUT = 'certificateFile';

/** The kind of the enrollment input: a proving ceremony the page runs. */
export const METHOD_AADHAAR_ENROLL_KIND = 'ceremony';

/** The names the errors give the config, the proof, the digest and a word read off the stack. */
export const METHOD_AADHAAR_CONFIG_NAME = 'the config';
export const METHOD_AADHAAR_PROOF_NAME = 'the proof';
export const METHOD_AADHAAR_DIGEST_NAME = 'the digest';
export const METHOD_AADHAAR_WORD_NAME = 'a stack word';

/** The argument errors; where a message follows a field name, the name comes first. */
export const METHOD_AADHAAR_MISSING_MESSAGE = 'is missing';
export const METHOD_AADHAAR_LIST_MESSAGE = 'must be an array';
export const METHOD_AADHAAR_COUNT_MESSAGE = 'must have this many entries:';
export const METHOD_AADHAAR_LENGTH_MESSAGE = 'must have this many bytes:';
export const METHOD_AADHAAR_CANONICAL_MESSAGE = 'does not re-encode to the bytes it was decoded from';
export const METHOD_AADHAAR_EXTRA_FIELD_MESSAGE = 'is not a field of this layout';
export const METHOD_AADHAAR_SEED_TYPE_MESSAGE = 'must be a bigint or a safe integer';
export const METHOD_AADHAAR_SEED_RANGE_MESSAGE = 'must be at least zero and below the circuit field';
export const METHOD_AADHAAR_CERTIFICATE_MESSAGE = 'must be a non-empty PEM string';
export const METHOD_AADHAAR_SEED_MISMATCH_MESSAGE = 'is not the seed the config was enrolled under';
export const METHOD_AADHAAR_ARTIFACT_URL_MESSAGE = 'an artifact URL is not a non-empty string';
export const METHOD_AADHAAR_ARTIFACT_ORIGIN_MESSAGE = 'artifactsOrigin must be one of';
export const METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE = 'pass a stack or the artifacts for the installed stack, not both';

/** Why the default stack is unavailable (the package name prefixes the first two), and why a material signal was read as malformed. */
export const METHOD_AADHAAR_STACK_SURFACE_MESSAGE = 'does not expose the expected calls';
export const METHOD_AADHAAR_STACK_MISSING_MESSAGE = 'is not installed';
export const METHOD_AADHAAR_STACK_ORIGIN_MESSAGE = 'the stack names no such artifacts origin';
export const METHOD_AADHAAR_STACK_INIT_MESSAGE = 'the stack could not initialise with the given artifacts';
export const METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE = 'no artifacts were given';
export const METHOD_AADHAAR_SIGNAL_FAULT_MESSAGE =
  'the material signal threw while this module read it or added or removed its abort listener';
