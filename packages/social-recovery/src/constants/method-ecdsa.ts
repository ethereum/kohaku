import type { Address, DeviceBinding, ReplyFailure } from '../interfaces/records';

/** The config's ABI parameter list: `abi.encode(address signer)`. */
export const METHOD_ECDSA_CONFIG_ABI = [{ type: 'address' }] as const;

/** One ABI word holding an address: twelve zero bytes, then the address. */
export const METHOD_ECDSA_CONFIG_WORD = /^0x0{24}[0-9a-fA-F]{40}$/;

/** Where the address starts in a config word's hex. */
export const METHOD_ECDSA_CONFIG_ADDRESS_OFFSET = 26;

/** The config's one field name. */
export const METHOD_ECDSA_CONFIG_FIELD = 'signer';

/** The proof's one field name, also the material member `replyFrom` reads. */
export const METHOD_ECDSA_PROOF_FIELD = 'signature';

/** The enrollment parameter carrying the guardian's address. */
export const METHOD_ECDSA_ADDRESS_PARAM = 'address';

/** The zero address, which enrollment refuses and `verify` rejects as a signer. */
export const METHOD_ECDSA_ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Whole bytes as 0x-prefixed hex, empty allowed. */
export const METHOD_ECDSA_HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;

/** The secp256k1 group order. */
export const METHOD_ECDSA_CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The largest `s` OpenZeppelin's `ECDSA.tryRecover` accepts. */
export const METHOD_ECDSA_HALF_ORDER = METHOD_ECDSA_CURVE_ORDER >> 1n;

/** The byte length of an `r || s || v` signature. */
export const METHOD_ECDSA_SIGNATURE_LENGTH = 65;

/** Hex offsets within a 0x-prefixed 65-byte signature. */
export const METHOD_ECDSA_SIGNATURE_R_OFFSET = 2;
export const METHOD_ECDSA_SIGNATURE_S_OFFSET = 66;
export const METHOD_ECDSA_SIGNATURE_V_OFFSET = 130;
export const METHOD_ECDSA_SIGNATURE_END = 132;

/** Hex character counts. */
export const METHOD_ECDSA_HEX_PREFIX_LENGTH = 2;
export const METHOD_ECDSA_WORD_HEX_LENGTH = 64;
export const METHOD_ECDSA_BYTE_HEX_LENGTH = 2;

/** The recovery bytes OpenZeppelin's `ECDSA` accepts. */
export const METHOD_ECDSA_RECOVERY_LOW = 27;
export const METHOD_ECDSA_RECOVERY_HIGH = 28;

/** The failure every refused enrollment or reply answers. */
export const METHOD_ECDSA_MATERIAL_REJECTED: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

/** No device is bound: the guardian's own wallet signs. */
export const METHOD_ECDSA_DEVICE_BINDING: DeviceBinding = 'none';

/** The device kind `describe` reports. */
export const METHOD_ECDSA_DEVICE_KIND = 'typed-data-wallet';

/** The known-answer vector files the method's tests replay. */
export const METHOD_ECDSA_VECTORS: readonly string[] = ['method-ecdsa-config.json', 'method-ecdsa-proof.json'];

/** The codec's error messages. */
export const METHOD_ECDSA_CONFIG_BYTES_MESSAGE = 'method-ecdsa config: expected one 32-byte word holding an address';
export const METHOD_ECDSA_CONFIG_SIGNER_MESSAGE = 'method-ecdsa config: "signer" is not an address';
export const METHOD_ECDSA_PROOF_BYTES_MESSAGE = 'method-ecdsa proof: not whole bytes of hex';
export const METHOD_ECDSA_PROOF_SIGNATURE_MESSAGE = 'method-ecdsa proof: "signature" is not whole bytes of hex';
