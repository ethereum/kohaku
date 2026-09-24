import {
  BACKUP_NONCE_SIZE,
  BACKUP_PADDING_SIZE,
  BACKUP_SEALED_PAYLOAD_SIZE as SEALED_PAYLOAD_SIZE,
} from '../constants';
import type { BackupAuthenticated, Configuration, Hex } from '../interfaces';
import { encodeAssociatedData } from './associated-data';
import { decrypt, deriveKey, encrypt } from './cipher';
import { parseConfigurationBytes } from './deserialize';
import { BackupTooWideError, BackupUnopenedError } from './errors';
import { bytesToHex, fixedHexToBytes, hexToBytes } from './hex';
import { serializeConfigurationBytes } from './serialize';

/**
 * Seals `configuration` under `password` as the nonce, the ciphertext and the tag, binding `authenticated`.
 * `paddingSize` must be `BACKUP_PADDING_SIZE`; any other value throws a RangeError.
 * The caller draws a fresh random `nonce` for every seal: the key is fixed by the password and `authenticated`,
 * so a repeated nonce breaks AES-GCM.
 * Throws `BackupTooWideError` when the serialization exceeds the padding, and a TypeError or RangeError on a
 * malformed argument.
 */
export async function sealBackup(
  configuration: Configuration,
  password: string,
  nonce: Hex,
  paddingSize: number,
  authenticated: BackupAuthenticated,
): Promise<Hex> {
  if (typeof password !== 'string') throw new TypeError('password must be a string');

  if (paddingSize !== BACKUP_PADDING_SIZE) {
    throw new RangeError(`paddingSize must be the shipped BACKUP_PADDING_SIZE of ${BACKUP_PADDING_SIZE} bytes`);
  }

  const nonceBytes = fixedHexToBytes(nonce, BACKUP_NONCE_SIZE, 'nonce');
  const additionalData = encodeAssociatedData(authenticated);
  const serialized = serializeConfigurationBytes(configuration);

  if (serialized.length > paddingSize) throw new BackupTooWideError(serialized.length, paddingSize);

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
 * Opens a payload `sealBackup` produced under the same password and `authenticated` values.
 * Every hex payload that does not open, including one of the wrong length, throws `BackupUnopenedError`;
 * a malformed `password` or `authenticated`, or a payload that is not hex, throws a TypeError or RangeError.
 */
export async function openBackup(payload: Hex, password: string, authenticated: BackupAuthenticated): Promise<Configuration> {
  if (typeof password !== 'string') throw new TypeError('password must be a string');

  const additionalData = encodeAssociatedData(authenticated);
  const bytes = hexToBytes(payload, 'payload');

  if (bytes.length !== SEALED_PAYLOAD_SIZE) throw new BackupUnopenedError(bytes.length);

  const key = await deriveKey(password, additionalData);
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
