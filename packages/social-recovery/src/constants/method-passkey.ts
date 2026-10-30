import type { DeviceBinding, DeviceKind, ReplyFailure } from '../interfaces';

/** The order `n` of the P-256 (secp256r1) group, as SEC 2 §2.4.2 lists it. */
export const METHOD_PASSKEY_P256_ORDER: bigint = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** `floor(n / 2)`, the largest `s` the low half holds. */
export const METHOD_PASSKEY_P256_HALF_ORDER: bigint = METHOD_PASSKEY_P256_ORDER >> 1n;

/** The width in bits of each config and proof word. */
export const METHOD_PASSKEY_WORD_BITS = 256;

/** The length of the config's three 32-byte words written as `0x` hex. */
export const METHOD_PASSKEY_CONFIG_HEX_LENGTH = 2 + 3 * 64;

/** The proof layout: `abi.encode(bytes authenticatorData, bytes clientDataJSON, uint256 r, uint256 s)`. */
export const METHOD_PASSKEY_PROOF_ABI = [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'uint256' }] as const;

/** The config's field names, as the vectors spell them. */
export const METHOD_PASSKEY_CONFIG_FIELDS = Object.freeze(['x', 'y', 'rpIdHash'] as const);

/** The proof's field names, as the vectors spell them. */
export const METHOD_PASSKEY_PROOF_FIELDS = Object.freeze(['authenticatorData', 'clientDataJSON', 'r', 's'] as const);

/** The prefix of every error the passkey method throws. */
export const METHOD_PASSKEY_ERROR_PREFIX = 'method-passkey';

/** The layout names a codec refusal starts with. */
export const METHOD_PASSKEY_LAYOUT_CONFIG = 'config';
export const METHOD_PASSKEY_LAYOUT_PROOF = 'proof';

/** The fixed reasons the codec refuses a value or bytes with. */
export const METHOD_PASSKEY_CODEC_REFUSALS = Object.freeze({
  fields: 'expected exactly the fields',
  configWords: 'expected three 32-byte words',
  proofClientDataText: 'must be text',
  proofHighS: 's is not in the low half',
  proofLayout: 'not the ABI layout (bytes, bytes, uint256, uint256)',
  proofClientDataUtf8: 'clientDataJSON is not UTF-8 text',
  proofCanonical: 'not the canonical encoding',
} as const);

/** What a ceremony parameter that is missing, empty or not a string is refused with. */
export const METHOD_PASSKEY_TEXT_PARAM_MESSAGE = 'must be a non-empty string';

/** The name the enrollment parameters are refused under when they are not an object. */
export const METHOD_PASSKEY_PARAMS_NAME = 'params';

/** The name the enrollment input is refused under when it is not an object. */
export const METHOD_PASSKEY_ENROLL_INPUT_NAME = 'input';

/** The ceremony parameter naming the relying party, also carried in each input the method returns. */
export const METHOD_PASSKEY_RELYING_PARTY_ID_PARAM = 'relyingPartyId';

/** The enrollment parameter naming the credential's user, also carried in the enrollment input. */
export const METHOD_PASSKEY_USER_NAME_PARAM = 'userName';

/** The optional signing parameter limiting the request to one credential, also carried in the signing input. */
export const METHOD_PASSKEY_CREDENTIAL_ID_PARAM = 'credentialId';

/** The input member holding the WebAuthn options the page hands the browser. */
export const METHOD_PASSKEY_OPTIONS_MEMBER = 'options';

/** The material member holding the `navigator.credentials.create` result. */
export const METHOD_PASSKEY_CREDENTIAL_MATERIAL = 'credential';

/** The material member holding the `navigator.credentials.get` result. */
export const METHOD_PASSKEY_ASSERTION_MATERIAL = 'assertion';

/** The failure `configFrom` and `replyFrom` return for any material they refuse. */
export const METHOD_PASSKEY_MATERIAL_REJECTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'material-rejected' });

/** The device a passkey approval is made on. */
export const METHOD_PASSKEY_DEVICE_BINDING: DeviceBinding = 'browser-authenticator';

/** The device kind `describe` reports. */
export const METHOD_PASSKEY_DEVICE_KIND: DeviceKind = 'webauthn-authenticator';

/** The vector file of the config layout. */
export const METHOD_PASSKEY_CONFIG_VECTOR_FILE = 'method-passkey-config.json';

/** The vector file of the proof layout and the verdicts. */
export const METHOD_PASSKEY_PROOF_VECTOR_FILE = 'method-passkey-proof.json';

/** The vector files the method replays, config first. */
export const METHOD_PASSKEY_VECTOR_FILES: readonly string[] = Object.freeze([METHOD_PASSKEY_CONFIG_VECTOR_FILE, METHOD_PASSKEY_PROOF_VECTOR_FILE]);
