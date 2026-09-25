import {
  BACKUP_ADDRESS_SIZE as ADDRESS_SIZE,
  BACKUP_CLAUSE_HEADER_SIZE as CLAUSE_HEADER_SIZE,
  BACKUP_COUNT_SIZE as COUNT_SIZE,
  BACKUP_CREDENTIAL_FIXED_SIZE as CREDENTIAL_FIXED_SIZE,
  BACKUP_FLAG_SIZE as FLAG_SIZE,
  BACKUP_HEADER_SIZE as HEADER_SIZE,
  BACKUP_LENGTH_SIZE as LENGTH_SIZE,
  BACKUP_MAX_THRESHOLD as MAX_THRESHOLD,
  BACKUP_MAX_UINT16 as MAX_UINT16,
  BACKUP_MAX_WAIT as MAX_WAIT,
  BACKUP_SALT_ABSENT as SALT_ABSENT,
  BACKUP_SALT_PRESENT as SALT_PRESENT,
  BACKUP_SALT_SIZE as SALT_SIZE,
  BACKUP_THRESHOLD_SIZE as THRESHOLD_SIZE,
  BACKUP_WAIT_SIZE as WAIT_SIZE,
} from '../constants';
import type { Clause, Configuration, Credential, Hex } from '../interfaces';
import type { ClauseBytes, CredentialBytes } from '../types';
import { bytesToHex, fixedHexToBytes, hexToBytes, writeUint } from './hex';

function checkInteger(value: unknown, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${what} must be an integer from 0 to ${max}`);
  }

  return value;
}

function checkCount(items: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(items)) throw new TypeError(`${what} must be an array`);

  checkInteger(items.length, MAX_UINT16, `${what} count`);

  return items;
}

function credentialBytes(credential: Credential, where: string): CredentialBytes {
  const method = fixedHexToBytes(credential.method, ADDRESS_SIZE, `${where}.method`);
  const config = hexToBytes(credential.config, `${where}.config`);

  checkInteger(config.length, MAX_UINT16, `${where}.config length`);

  if (credential.salt === undefined) return { method, config };

  return { method, config, salt: fixedHexToBytes(credential.salt, SALT_SIZE, `${where}.salt`) };
}

function clauseBytes(clause: Clause, where: string): ClauseBytes {
  const threshold = checkInteger(clause.threshold, MAX_THRESHOLD, `${where}.threshold`);
  const credentials = checkCount(clause.credentials, `${where}.credentials`) as readonly Credential[];

  return {
    threshold,
    credentials: credentials.map((credential, index) => credentialBytes(credential, `${where}.credentials[${index}]`)),
  };
}

const credentialSize = (credential: CredentialBytes): number =>
  CREDENTIAL_FIXED_SIZE + credential.config.length + (credential.salt === undefined ? 0 : SALT_SIZE);

/** Writes the configuration's big-endian bytes; throws a TypeError or RangeError on a field outside its width. */
export function serializeConfigurationBytes(configuration: Configuration): Uint8Array<ArrayBuffer> {
  const wait = checkInteger(configuration.wait, MAX_WAIT, 'configuration.wait');

  if (typeof configuration.ignoresPause !== 'boolean') {
    throw new TypeError('configuration.ignoresPause must be a boolean');
  }

  const clauses = (checkCount(configuration.clauses, 'configuration.clauses') as readonly Clause[]).map(
    (clause, index) => clauseBytes(clause, `configuration.clauses[${index}]`),
  );
  const size = clauses.reduce(
    (total, clause) => clause.credentials.reduce((sum, item) => sum + credentialSize(item), total + CLAUSE_HEADER_SIZE),
    HEADER_SIZE,
  );
  const out = new Uint8Array(size);
  let offset = 0;
  const put = (bytes: Uint8Array): void => {
    out.set(bytes, offset);
    offset += bytes.length;
  };
  const putUint = (width: number, value: number): void => {
    writeUint(out, offset, width, BigInt(value));
    offset += width;
  };

  putUint(WAIT_SIZE, wait);
  putUint(FLAG_SIZE, configuration.ignoresPause ? 1 : 0);
  putUint(COUNT_SIZE, clauses.length);

  for (const clause of clauses) {
    putUint(THRESHOLD_SIZE, clause.threshold);
    putUint(COUNT_SIZE, clause.credentials.length);

    for (const credential of clause.credentials) {
      put(credential.method);
      putUint(LENGTH_SIZE, credential.config.length);
      put(credential.config);
      putUint(FLAG_SIZE, credential.salt === undefined ? SALT_ABSENT : SALT_PRESENT);

      if (credential.salt !== undefined) put(credential.salt);
    }
  }

  return out;
}

/**
 * The configuration's serialization as hex, the plaintext `sealBackup` pads and seals.
 * Throws a TypeError or RangeError on a field outside its width.
 */
export const serializeConfiguration = (configuration: Configuration): Hex =>
  bytesToHex(serializeConfigurationBytes(configuration));
