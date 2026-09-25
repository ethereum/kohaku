import type { DeviceBinding } from '../interfaces/records';

/** The two vector files this implementation's tests replay. */
export const METHOD_AADHAAR_VECTOR_FILES = ['method-aadhaar-config.json', 'method-aadhaar-proof.json'] as const;

/** The config's ABI layout. */
export const METHOD_AADHAAR_CONFIG_ABI = [
  { name: 'nullifier', type: 'uint256' },
  { name: 'nullifierSeed', type: 'uint256' },
] as const;

/** The config's exact length in bytes. */
export const METHOD_AADHAAR_CONFIG_BYTES = 64;

/** The proof's ABI layout, the Groth16 verifier's `verifyProof` arguments. */
export const METHOD_AADHAAR_PROOF_ABI = [
  { name: 'a', type: 'uint256[2]' },
  { name: 'b', type: 'uint256[2][2]' },
  { name: 'c', type: 'uint256[2]' },
  { name: 'inputs', type: 'uint256[9]' },
] as const;

/** The proof's exact length in bytes. */
export const METHOD_AADHAAR_PROOF_BYTES = 544;

/** The words in one Groth16 coordinate pair. */
export const METHOD_AADHAAR_PAIR_WORDS = 2;

/** The pairs in the Groth16 `b` point. */
export const METHOD_AADHAAR_B_PAIRS = 2;

/** The public inputs by position, in the circuit's order. */
export const METHOD_AADHAAR_PUBLIC_INPUTS = [
  'pubkeyHash',
  'nullifier',
  'timestamp',
  'ageAbove18',
  'gender',
  'pincode',
  'state',
  'nullifierSeed',
  'signalHash',
] as const;

/** The number of public inputs. */
export const METHOD_AADHAAR_PUBLIC_INPUT_COUNT = METHOD_AADHAAR_PUBLIC_INPUTS.length;

/** One past the largest value an ABI `uint256` holds. */
export const METHOD_AADHAAR_WORD_LIMIT = 1n << 256n;

/**
 * The circuit's scalar field; a seed at or above it would enter the circuit
 * reduced and prove a seed other than the one the config records.
 */
export const METHOD_AADHAAR_SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The right shift that brings keccak256 of the digest inside the circuit's field. */
export const METHOD_AADHAAR_SIGNAL_HASH_SHIFT = 3n;

/** A decimal string. */
export const METHOD_AADHAAR_DECIMAL_PATTERN = /^\d+$/;

/** 0x-prefixed hex of any length. */
export const METHOD_AADHAAR_HEX_PATTERN = /^0x[0-9a-fA-F]*$/;

/** A 32-byte word as 0x-prefixed hex. */
export const METHOD_AADHAAR_DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** The error a malformed digest raises. */
export const METHOD_AADHAAR_DIGEST_ERROR = 'the digest is not a 32-byte word as 0x-prefixed hex';

/** The projective coordinate snarkjs appends to a G1 point. */
export const METHOD_AADHAAR_G1_PROJECTIVE = '1';

/** The projective coordinate snarkjs appends to a G2 point. */
export const METHOD_AADHAAR_G2_PROJECTIVE = ['1', '0'] as const;

/** The protocol and curve snarkjs names on a Groth16 proof. */
export const METHOD_AADHAAR_GROTH16_PROTOCOL = 'groth16';
export const METHOD_AADHAAR_GROTH16_CURVE = 'bn128';

/** The DOM event a signal fires on abort. */
export const METHOD_AADHAAR_ABORT_EVENT = 'abort';

/** The proving stack's package and the one version this build is pinned to. */
export const METHOD_AADHAAR_STACK_PACKAGE = '@anon-aadhaar/core';
export const METHOD_AADHAAR_STACK_VERSION = '2.4.3';

/** The calls the loaded stack must expose as functions. */
export const METHOD_AADHAAR_STACK_CALLS = ['init', 'generateArgs', 'prove', 'verify'] as const;

/** The artifact origins the stack's `ArtifactsOrigin` names. */
export const METHOD_AADHAAR_ARTIFACT_ORIGINS = ['server', 'local', 'chunked'] as const;

/** Where the proof is made: a prover running in the approver's browser. */
export const METHOD_AADHAAR_DEVICE_BINDING: DeviceBinding = 'in-browser-prover';

/** Facts about the approver's device and the stack's standing. */
export const METHOD_AADHAAR_DEVICE_FACTS = {
  kind: 'in-page-prover',
  prover: 'in-browser',
  qrImageLeavesDevice: false,
  provingTakes: 'tens-of-seconds',
  stack: METHOD_AADHAAR_STACK_PACKAGE,
  stackVersion: METHOD_AADHAAR_STACK_VERSION,
  stackStanding: 'pinned-only',
} as const;
