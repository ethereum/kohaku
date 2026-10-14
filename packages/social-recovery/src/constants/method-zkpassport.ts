import type { DeviceBinding, ReplyFailure } from '../interfaces/records';

/** The config's ABI layout; it names no zkPassport version, since the module routes every proof with the version its trusted keys accept. */
export const METHOD_ZKPASSPORT_CONFIG_LAYOUT = [
  { name: 'uniqueIdentifier', type: 'bytes32' },
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

/** The config record's field names, in layout order. */
export const METHOD_ZKPASSPORT_CONFIG_FIELDS = Object.freeze(['uniqueIdentifier', 'domain', 'scope', 'validityPeriodInSeconds'] as const);

/** The proof record's field names, in layout order. */
export const METHOD_ZKPASSPORT_PROOF_FIELDS = Object.freeze(['proofVerificationData', 'committedInputs'] as const);

/** The `proofVerificationData` field names, in layout order. */
export const METHOD_ZKPASSPORT_PROOF_DATA_FIELDS = Object.freeze(['vkeyHash', 'proof', 'publicInputs'] as const);

/** The bit width of the config's validity period. */
export const METHOD_ZKPASSPORT_VALIDITY_BITS = 256;

/** The hex length of one 32-byte word, the width an identifier is padded to. */
export const METHOD_ZKPASSPORT_WORD_HEX_LENGTH = 64;

/** The name prefix of the outer EVM proof. */
export const METHOD_ZKPASSPORT_OUTER_EVM_PREFIX = 'outer_evm';

/** The committed-inputs key of the bind circuit in `compressed-evm` mode. */
export const METHOD_ZKPASSPORT_BIND_EVM_KEY = 'bind_evm';

/** The key under a committed input that holds its values. */
export const METHOD_ZKPASSPORT_BIND_DATA_KEY = 'data';

/** The ceremony material's list of proofs, as a refusal names it. */
export const METHOD_ZKPASSPORT_PROOFS_NAME = 'proofs';

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
export const METHOD_ZKPASSPORT_DISPLAY_FIELDS = Object.freeze(['name', 'logo', 'purpose'] as const);

/** The app the approver proves in, as `describe` names it. */
export const METHOD_ZKPASSPORT_APP = 'zkPassport';

/** The approver proves in an app outside the browser. */
export const METHOD_ZKPASSPORT_DEVICE_BINDING: DeviceBinding = 'external-app';

/** The device kind `describe` reports. */
export const METHOD_ZKPASSPORT_DEVICE_KIND = 'external-proving-app';

/** The blessed vector files that fix the config and proof layouts. */
export const METHOD_ZKPASSPORT_VECTOR_FILES: readonly string[] = Object.freeze(['method-zkpassport-config.json', 'method-zkpassport-proof.json']);

/** The failure a refused enrollment or reply answers. */
export const METHOD_ZKPASSPORT_MATERIAL_REJECTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'material-rejected' });

/** The failure answered where the stack cannot be loaded. */
export const METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'device-unavailable' });

/** The names the codec's refusals give the two layouts. */
export const METHOD_ZKPASSPORT_CONFIG_NAME = 'method-zkpassport config';
export const METHOD_ZKPASSPORT_PROOF_NAME = 'method-zkpassport proof';

/** The layouts as the codec's decode refusals spell them. */
export const METHOD_ZKPASSPORT_CONFIG_SIGNATURE = '(bytes32,string,string,uint256)';
export const METHOD_ZKPASSPORT_PROOF_SIGNATURE = '((bytes32,bytes,bytes32[]),bytes)';

/** The codec's refusal messages, each following the layout's name or a field's. */
export const METHOD_ZKPASSPORT_RECORD_MESSAGE = 'must be a record';
export const METHOD_ZKPASSPORT_FIELDS_MESSAGE = 'must hold exactly the fields';
export const METHOD_ZKPASSPORT_TEXT_MESSAGE = 'must be a string';
export const METHOD_ZKPASSPORT_MISSING_MESSAGE = 'is missing';

/** Thrown by `digestText` on a digest that is not hex. */
export const METHOD_ZKPASSPORT_DIGEST_HEX_MESSAGE = 'method-zkpassport: the digest is not 0x-prefixed hex';

/** Thrown by `digestText` on hex that is not 32 bytes. */
export const METHOD_ZKPASSPORT_DIGEST_WIDTH_MESSAGE = 'method-zkpassport: the digest is not 32 bytes';

/** Thrown where the parameters lack a domain or a scope. */
export const METHOD_ZKPASSPORT_SESSION_MESSAGE = 'method-zkpassport: params need a non-empty "domain" and "scope"';

/** Thrown where a shown text is given but is not a string. */
export const METHOD_ZKPASSPORT_DISPLAY_MESSAGE = 'method-zkpassport: "name", "logo" and "purpose" must be strings where given';
