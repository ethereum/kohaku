import {
  BACKUP_LEGACY_PAYLOAD_VERSION,
  BACKUP_NONCE_SIZE,
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  BACKUP_READ_PAYLOAD_VERSIONS,
  BACKUP_SEALED_PAYLOAD_SIZE as SEALED_PAYLOAD_SIZE,
} from '../constants';
import type { BackupAuthenticated, Configuration, Hex } from '../interfaces';
import { encodeAssociatedData } from './associated-data';
import { assertPassword, decrypt, deriveKey, encrypt } from './cipher';
import { parseConfigurationBytes } from './deserialize';
import { BackupTooWideError, BackupUnopenedError } from './errors';
import { bytesToHex, fixedHexToBytes, hexToBytes } from './hex';
import { serializeConfigurationBytes } from './serialize';

/**
 * Seals `configuration` under `password` as the nonce, the ciphertext and the tag, binding `authenticated`, whose
 * associated data is also the key's PBKDF2 salt.
 * `paddingSize` must be `BACKUP_PADDING_SIZE` and `authenticated.payloadVersion` must be `BACKUP_PAYLOAD_VERSION`;
 * any other value throws a RangeError before a key is derived.
 * The caller draws a fresh random `nonce` for every seal: the key is fixed by the password and the authenticated
 * values, so a nonce repeated in two seals for the same setup under one password breaks AES-GCM.
 * Throws `BackupTooWideError` when the serialization exceeds the padding, and a TypeError or RangeError on a
 * malformed argument, including a password with a lone surrogate.
 */
export async function sealBackup(
  configuration: Configuration,
  password: string,
  nonce: Hex,
  paddingSize: number,
  authenticated: BackupAuthenticated,
): Promise<Hex> {
  assertPassword(password);

  if (paddingSize !== BACKUP_PADDING_SIZE) {
    throw new RangeError(`paddingSize must be the shipped BACKUP_PADDING_SIZE of ${BACKUP_PADDING_SIZE} bytes`);
  }

  const nonceBytes = fixedHexToBytes(nonce, BACKUP_NONCE_SIZE, 'nonce');
  const additionalData = encodeAssociatedData(authenticated);
  const serialized = serializeConfigurationBytes(configuration);

  if (serialized.length > paddingSize) throw new BackupTooWideError(serialized.length, paddingSize);

  if (authenticated.payloadVersion !== BACKUP_PAYLOAD_VERSION) {
    throw new RangeError(`authenticated.payloadVersion must be the written BACKUP_PAYLOAD_VERSION of ${BACKUP_PAYLOAD_VERSION}`);
  }

  const plaintext = new Uint8Array(paddingSize);

  plaintext.set(serialized);

  const key = await deriveKey(password, additionalData);
  const sealed = await encrypt(key, nonceBytes, additionalData, plaintext);
  const payload = new Uint8Array(BACKUP_NONCE_SIZE + sealed.length);

  payload.set(nonceBytes);
  payload.set(sealed, BACKUP_NONCE_SIZE);

  return bytesToHex(payload);
}

/** Whether every byte from `start` on is zero. */
const zeroFrom = (bytes: Uint8Array, start: number): boolean => bytes.subarray(start).every((byte) => byte === 0);

/**
 * Opens a payload sealed under the same password and `authenticated` values, at the payload version they name:
 * `BACKUP_PAYLOAD_VERSION`, keyed over the associated data, or `BACKUP_LEGACY_PAYLOAD_VERSION`, keyed over an empty salt.
 * Every hex payload that does not open, including one of the wrong length or under a version outside
 * `BACKUP_READ_PAYLOAD_VERSIONS`, throws `BackupUnopenedError`, before a key is derived in those two cases;
 * a malformed `password` or `authenticated`, or a payload that is not hex, throws a TypeError or RangeError.
 */
export async function openBackup(payload: Hex, password: string, authenticated: BackupAuthenticated): Promise<Configuration> {
  assertPassword(password);

  const additionalData = encodeAssociatedData(authenticated);
  const bytes = hexToBytes(payload, 'payload');

  if (bytes.length !== SEALED_PAYLOAD_SIZE) throw new BackupUnopenedError(bytes.length);

  const { payloadVersion } = authenticated;

  if (!BACKUP_READ_PAYLOAD_VERSIONS.some((version) => version === payloadVersion)) throw new BackupUnopenedError(bytes.length);

  const salt = payloadVersion === BACKUP_LEGACY_PAYLOAD_VERSION ? new Uint8Array(0) : additionalData;
  const key = await deriveKey(password, salt);
  let plaintext: Uint8Array;

  try {
    plaintext = await decrypt(key, bytes.slice(0, BACKUP_NONCE_SIZE), additionalData, bytes.slice(BACKUP_NONCE_SIZE));
  } catch {
    throw new BackupUnopenedError(bytes.length);
  }

  try {
    const parsed = parseConfigurationBytes(plaintext);

    if (zeroFrom(plaintext, parsed.length)) return parsed.configuration;
  } catch {
    // Falls through to the refusal below.
  }

  throw new BackupUnopenedError(bytes.length);
}
