/** The config's ABI layout. */
export const METHOD_ZKPASSPORT_CONFIG_LAYOUT = [
  { name: 'uniqueIdentifier', type: 'bytes32' },
  { name: 'version', type: 'bytes32' },
  { name: 'domain', type: 'string' },
  { name: 'scope', type: 'string' },
  { name: 'validityPeriodInSeconds', type: 'uint256' },
] as const;

/** The proof's ABI layout, members in the verifier's own order. */
export const METHOD_ZKPASSPORT_PROOF_LAYOUT = [
  {
    name: 'proofVerificationData',
    type: 'tuple',
    components: [
      { name: 'vkeyHash', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
      { name: 'publicInputs', type: 'bytes32[]' },
    ],
  },
  { name: 'committedInputs', type: 'bytes' },
] as const;

/** The proof record's field names, in layout order. */
export const METHOD_ZKPASSPORT_PROOF_FIELDS = ['proofVerificationData', 'committedInputs'] as const;

/** The `ProofVerificationData` field names, in layout order. */
export const METHOD_ZKPASSPORT_PROOF_DATA_FIELDS = ['vkeyHash', 'proof', 'publicInputs'] as const;

/** One 32-byte word as hex, either case. */
export const METHOD_ZKPASSPORT_WORD_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** A digest `digestText` accepts: 32 bytes of hex, either case. */
export const METHOD_ZKPASSPORT_DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Whole bytes of hex, either case, possibly none. */
export const METHOD_ZKPASSPORT_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

/** A decimal unsigned integer, the form the stack reports a unique identifier in. */
export const METHOD_ZKPASSPORT_DECIMAL_PATTERN = /^[0-9]+$/;

/** The hex length of one 32-byte word, the width an identifier is padded to. */
export const METHOD_ZKPASSPORT_WORD_HEX_LENGTH = 64;

/** One past the largest `uint256`. */
export const METHOD_ZKPASSPORT_UINT256_LIMIT = 1n << 256n;

/** The name prefix of the outer EVM proof. */
export const METHOD_ZKPASSPORT_OUTER_EVM_PREFIX = 'outer_evm';

/** The committed-inputs key of the bind circuit in `compressed-evm` mode. */
export const METHOD_ZKPASSPORT_BIND_EVM_KEY = 'bind_evm';

/** The key under a committed input that holds its values. */
export const METHOD_ZKPASSPORT_BIND_DATA_KEY = 'data';

/** The custom field the digest's text is bound to. */
export const METHOD_ZKPASSPORT_CUSTOM_DATA_KEY = 'custom_data';

/** The non-salted nullifier type, the only one `verify` accepts; a dev-mode mock carries another. */
export const METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER = 0n;

/** The nullifier type's position in the outer proof's public inputs, counted from the end as `@zkpassport/utils` 0.38.0 lays them out. */
export const METHOD_ZKPASSPORT_NULLIFIER_TYPE_FROM_END = 3;

/** The scoped nullifier's position in the outer proof's public inputs, counted from the end. */
export const METHOD_ZKPASSPORT_SCOPED_NULLIFIER_FROM_END = 2;

/** The fewest public inputs that hold both trailing values. */
export const METHOD_ZKPASSPORT_MIN_PUBLIC_INPUTS = 3;

/** The proof mode every request asks for. */
export const METHOD_ZKPASSPORT_REQUEST_MODE = 'compressed-evm';

/** Dev mode, off on every request and every verifier-parameter call. */
export const METHOD_ZKPASSPORT_DEV_MODE = false;

/** The texts the phone shows, passed to the request only where given. */
export const METHOD_ZKPASSPORT_DISPLAY_FIELDS = ['name', 'logo', 'purpose'] as const;

/** The app the approver proves in, as `describe` names it. */
export const METHOD_ZKPASSPORT_APP = 'zkPassport';

/** The blessed vector files that fix the config and proof layouts. */
export const METHOD_ZKPASSPORT_VECTOR_FILES = ['method-zkpassport-config.json', 'method-zkpassport-proof.json'] as const;

/** Thrown by `digestText` on anything but 32 bytes of hex. */
export const METHOD_ZKPASSPORT_DIGEST_ERROR = 'method-zkpassport: the digest is not 32 bytes of hex';

/** Thrown where the parameters lack a domain or a scope. */
export const METHOD_ZKPASSPORT_SESSION_ERROR = 'method-zkpassport: params need a non-empty "domain" and "scope"';

/** Thrown where a shown text is given but is not a string. */
export const METHOD_ZKPASSPORT_DISPLAY_ERROR = 'method-zkpassport: "name", "logo" and "purpose" must be strings where given';
