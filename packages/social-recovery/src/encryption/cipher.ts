import {
  BACKUP_CIPHER,
  BACKUP_KDF,
  BACKUP_KDF_HASH,
  BACKUP_KDF_ITERATIONS,
  BACKUP_KEY_BITS,
  BACKUP_LONE_SURROGATE_PATTERN,
  BACKUP_TAG_SIZE,
} from '../constants';

/** Refuses a non-string and a string with a lone surrogate, which would share a key with its U+FFFD spelling. */
export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string') throw new TypeError('password must be a string');

  if (BACKUP_LONE_SURROGATE_PATTERN.test(password)) {
    throw new TypeError('password must be well-formed UTF-16, with no lone surrogate');
  }
}

function subtle(): SubtleCrypto {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;

  if (crypto?.subtle === undefined) throw new Error('WebCrypto is unavailable: globalThis.crypto.subtle is missing');

  return crypto.subtle;
}

/**
 * Derives a non-extractable AES-256-GCM key from the password's UTF-8 bytes with PBKDF2 over an empty salt,
 * so the same password gives the same key for every account and setup.
 */
export async function deriveKey(password: string): Promise<CryptoKey> {
  const api = subtle();
  const material = await api.importKey('raw', new TextEncoder().encode(password), BACKUP_KDF, false, ['deriveKey']);

  return api.deriveKey(
    { name: BACKUP_KDF, hash: BACKUP_KDF_HASH, salt: new Uint8Array(0), iterations: BACKUP_KDF_ITERATIONS },
    material,
    { name: BACKUP_CIPHER, length: BACKUP_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

const gcm = (nonce: Uint8Array<ArrayBuffer>, additionalData: Uint8Array<ArrayBuffer>): AesGcmParams => ({
  name: BACKUP_CIPHER,
  iv: nonce,
  additionalData,
  tagLength: BACKUP_TAG_SIZE * 8,
});

/** Encrypts `plaintext`, returning the ciphertext followed by the tag. */
export async function encrypt(
  key: CryptoKey,
  nonce: Uint8Array<ArrayBuffer>,
  additionalData: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().encrypt(gcm(nonce, additionalData), key, plaintext));
}

/** Decrypts the ciphertext and tag; rejects when the tag does not verify. */
export async function decrypt(
  key: CryptoKey,
  nonce: Uint8Array<ArrayBuffer>,
  additionalData: Uint8Array<ArrayBuffer>,
  sealed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().decrypt(gcm(nonce, additionalData), key, sealed));
}
