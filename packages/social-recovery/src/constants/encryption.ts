/** The wait field's size, a `uint48`. */
export const BACKUP_WAIT_SIZE = 6;

/** The size of the pause flag and of a credential's salt flag. */
export const BACKUP_FLAG_SIZE = 1;

/** The size of a clause count or a credential count, a `uint16`. */
export const BACKUP_COUNT_SIZE = 2;

/** A clause threshold's size, a `uint8`. */
export const BACKUP_THRESHOLD_SIZE = 1;

/** An address's size in bytes. */
export const BACKUP_ADDRESS_SIZE = 20;

/** The size of a config's length field, a `uint16`. */
export const BACKUP_LENGTH_SIZE = 2;

/** A supplied salt's size, a `bytes32`. */
export const BACKUP_SALT_SIZE = 32;

/** The largest value a `uint16` count or length field holds. */
export const BACKUP_MAX_UINT16 = 0xffff;

/** The largest threshold, a `uint8`. */
export const BACKUP_MAX_THRESHOLD = 0xff;

/** The largest wait, a `uint48`. */
export const BACKUP_MAX_WAIT = 2 ** 48 - 1;

/** The serialization's fixed header size. */
export const BACKUP_HEADER_SIZE = BACKUP_WAIT_SIZE + BACKUP_FLAG_SIZE + BACKUP_COUNT_SIZE;

/** A clause's size before its credentials. */
export const BACKUP_CLAUSE_HEADER_SIZE = BACKUP_THRESHOLD_SIZE + BACKUP_COUNT_SIZE;

/** A credential's size without its config and salt. */
export const BACKUP_CREDENTIAL_FIXED_SIZE = BACKUP_ADDRESS_SIZE + BACKUP_LENGTH_SIZE + BACKUP_FLAG_SIZE;

/** The salt flag of a credential with no supplied salt. */
export const BACKUP_SALT_ABSENT = 0x00;

/** The salt flag of a credential whose supplied salt follows. */
export const BACKUP_SALT_PRESENT = 0x01;

/** The backup payload's version, bound in the associated data and raised whenever the scheme changes. */
export const BACKUP_PAYLOAD_VERSION = 1;

/** The WebCrypto key derivation over the password. */
export const BACKUP_KDF = 'PBKDF2';

/** PBKDF2-HMAC-SHA256 iterations for the password's key. */
export const BACKUP_KDF_ITERATIONS = 600_000;

/** The PBKDF2 hash. */
export const BACKUP_KDF_HASH = 'SHA-256';

/** The WebCrypto cipher. */
export const BACKUP_CIPHER = 'AES-GCM';

/** AES-256-GCM's key length in bits. */
export const BACKUP_KEY_BITS = 256;

/** The size of the AES-GCM nonce the caller supplies. */
export const BACKUP_NONCE_SIZE = 12;

/** The AES-GCM tag's size in bytes. */
export const BACKUP_TAG_SIZE = 16;

/** The credential count this payload version sizes its padding for. */
export const BACKUP_CREDENTIAL_COUNT = 16;

/** The passkey config's width, `abi.encode(uint256 x, uint256 y, bytes32 rpIdHash)`, the padding is computed from. */
export const BACKUP_WIDEST_CONFIG_SIZE = 96;

/** A credential's method address size. */
export const BACKUP_METHOD_SIZE = 20;

/**
 * The plaintext size every seal pads to: the largest serialization of `BACKUP_CREDENTIAL_COUNT` credentials,
 * each in its own clause with a passkey-width config and a supplied salt; `sealBackup` refuses any other size.
 */
export const BACKUP_PADDING_SIZE =
  BACKUP_HEADER_SIZE +
  BACKUP_CREDENTIAL_COUNT *
    (BACKUP_CLAUSE_HEADER_SIZE + BACKUP_CREDENTIAL_FIXED_SIZE + BACKUP_WIDEST_CONFIG_SIZE + BACKUP_SALT_SIZE);

/** A sealed payload's size in bytes; `openBackup` refuses any other length. */
export const BACKUP_SEALED_PAYLOAD_SIZE = BACKUP_NONCE_SIZE + BACKUP_PADDING_SIZE + BACKUP_TAG_SIZE;

/** One word of the associated data's `abi.encode`. */
export const BACKUP_WORD_SIZE = 32;

/** The associated data's size in bytes. */
export const BACKUP_ASSOCIATED_DATA_SIZE = 5 * BACKUP_WORD_SIZE;

/** The largest setup nonce, a `uint64`. */
export const BACKUP_MAX_SETUP_NONCE = 2n ** 64n - 1n;

/** `BackupUnopenedError`'s default message. */
export const BACKUP_UNOPENED_MESSAGE = 'backup payload did not open under this password and these authenticated values';

/** Matches the hex digits, either case, after a `0x` prefix. */
export const BACKUP_HEX_BODY = /^[0-9a-fA-F]*$/;
