import type { DeviceBinding, DeviceKind, ReplyFailure } from '../interfaces';

/** The order `n` of the P-256 (secp256r1) group, as SEC 2 §2.4.2 lists it. */
export const METHOD_PASSKEY_P256_ORDER: bigint = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** `floor(n / 2)`, the largest `s` the low half holds. */
export const METHOD_PASSKEY_P256_HALF_ORDER: bigint = METHOD_PASSKEY_P256_ORDER >> 1n;

/** One past the largest `uint256` value. */
export const METHOD_PASSKEY_UINT256_LIMIT = 1n << 256n;

/** The length of a 32-byte word written as `0x` hex. */
export const METHOD_PASSKEY_WORD_HEX_LENGTH = 66;

/** The length of the config's three 32-byte words written as `0x` hex. */
export const METHOD_PASSKEY_CONFIG_HEX_LENGTH = 2 + 3 * 64;

/** The config layout: `abi.encode(uint256 x, uint256 y, bytes32 rpIdHash)`. */
export const METHOD_PASSKEY_CONFIG_ABI = [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }] as const;

/** The proof layout: `abi.encode(bytes authenticatorData, bytes clientDataJSON, uint256 r, uint256 s)`. */
export const METHOD_PASSKEY_PROOF_ABI = [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'uint256' }] as const;

/** The config's field names, as the vectors spell them. */
export const METHOD_PASSKEY_CONFIG_FIELDS = ['x', 'y', 'rpIdHash'] as const;

/** The proof's field names, as the vectors spell them. */
export const METHOD_PASSKEY_PROOF_FIELDS = ['authenticatorData', 'clientDataJSON', 'r', 's'] as const;

/** The prefix of every error the passkey method throws. */
export const METHOD_PASSKEY_ERROR_PREFIX = 'method-passkey';

/** The layout names a codec refusal starts with. */
export const METHOD_PASSKEY_LAYOUT_CONFIG = 'config';
export const METHOD_PASSKEY_LAYOUT_PROOF = 'proof';

/** The fixed reasons the codec refuses a value or bytes with. */
export const METHOD_PASSKEY_CODEC_REFUSALS = {
  configUint256: 'x and y must be uint256 values',
  configRpIdHash: 'rpIdHash must be 32 bytes of hex',
  configWords: 'expected three 32-byte words',
  proofAuthenticatorData: 'authenticatorData must be whole bytes of hex',
  proofClientDataText: 'clientDataJSON must be text',
  proofUint256: 'r and s must be uint256 values',
  proofHighS: 's is not in the low half',
  proofHex: 'not whole bytes of hex',
  proofLayout: 'not the ABI layout (bytes, bytes, uint256, uint256)',
  proofClientDataUtf8: 'clientDataJSON is not UTF-8 text',
  proofCanonical: 'not the canonical encoding',
} as const;

/** The failure `configFrom` and `replyFrom` return for any material they refuse. */
export const METHOD_PASSKEY_MATERIAL_REJECTED: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

/** The device a passkey approval is made on. */
export const METHOD_PASSKEY_DEVICE_BINDING: DeviceBinding = 'browser-authenticator';

/** The device kind `describe` reports. */
export const METHOD_PASSKEY_DEVICE_KIND: DeviceKind = 'webauthn-authenticator';

/** The vector file of the config layout. */
export const METHOD_PASSKEY_CONFIG_VECTOR_FILE = 'method-passkey-config.json';

/** The vector file of the proof layout and the verdicts. */
export const METHOD_PASSKEY_PROOF_VECTOR_FILE = 'method-passkey-proof.json';

/** The vector files the method replays, config first. */
export const METHOD_PASSKEY_VECTOR_FILES = [METHOD_PASSKEY_CONFIG_VECTOR_FILE, METHOD_PASSKEY_PROOF_VECTOR_FILE] as const;
