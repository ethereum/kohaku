import {
  BACKUP_CLAUSE_HEADER_SIZE as CLAUSE_HEADER_SIZE,
  BACKUP_COUNT_SIZE as COUNT_SIZE,
  BACKUP_CREDENTIAL_FIXED_SIZE as CREDENTIAL_FIXED_SIZE,
  BACKUP_FLAG_SIZE as FLAG_SIZE,
  BACKUP_HEADER_SIZE as HEADER_SIZE,
  BACKUP_LENGTH_SIZE as LENGTH_SIZE,
  BACKUP_SALT_ABSENT as SALT_ABSENT,
  BACKUP_SALT_PRESENT as SALT_PRESENT,
  BACKUP_SALT_SIZE as SALT_SIZE,
  BACKUP_THRESHOLD_SIZE as THRESHOLD_SIZE,
  BACKUP_UINT16_BITS as UINT16_BITS,
  BACKUP_WAIT_SIZE as WAIT_SIZE,
  FORMATS_THRESHOLD_BITS,
  FORMATS_WAIT_BITS,
} from '../constants';
import { assertArray, assertBool, assertBytes, assertBytes32, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { Clause, Configuration, Credential, Hex } from '../interfaces';
import type { ClauseBytes, CredentialBytes } from '../types/encryption';
import { bytesToHex, hexToBytes, writeUint } from './hex';

function checkElements(items: unknown, what: string): readonly object[] {
  assertArray(items, what);

  assertUintNumber(items.length, UINT16_BITS, `${what} count`);

  for (let index = 0; index < items.length; index += 1) assertObject(items[index], `${what}[${index}]`);

  return items as readonly object[];
}

function credentialBytes(credential: Credential, where: string): CredentialBytes {
  const method = hexToBytes(normalizeAddress(credential.method, `${where}.method`), `${where}.method`);
  const config = hexToBytes(credential.config, `${where}.config`);

  assertUintNumber(config.length, UINT16_BITS, `${where}.config length`);

  if (credential.salt === undefined) return { method, config };

  assertBytes32(credential.salt, `${where}.salt`);

  return { method, config, salt: hexToBytes(credential.salt, `${where}.salt`) };
}

function clauseBytes(clause: Clause, where: string): ClauseBytes {
  const { threshold } = clause;

  assertUintNumber(threshold, FORMATS_THRESHOLD_BITS, `${where}.threshold`);

  const credentials = checkElements(clause.credentials, `${where}.credentials`) as readonly Credential[];

  return {
    threshold,
    credentials: credentials.map((credential, index) => credentialBytes(credential, `${where}.credentials[${index}]`)),
  };
}

const credentialSize = (credential: CredentialBytes): number =>
  CREDENTIAL_FIXED_SIZE + credential.config.length + (credential.salt === undefined ? 0 : SALT_SIZE);

/**
 * The byte length `serializeConfigurationBytes` would produce, measured without refusing a field outside its width,
 * so a config or a count past its length field is measured rather than refused.
 */
export function serializedConfigurationSize(configuration: Configuration): number {
  assertObject(configuration, 'configuration');
  assertArray(configuration.clauses, 'configuration.clauses');

  return configuration.clauses.reduce((total: number, clause: Clause, index) => {
    assertObject(clause, `configuration.clauses[${index}]`);
    assertArray(clause.credentials, `configuration.clauses[${index}].credentials`);

    return clause.credentials.reduce((sum: number, credential: Credential, position) => {
      const where = `configuration.clauses[${index}].credentials[${position}]`;

      assertObject(credential, where);
      assertBytes(credential.config, `${where}.config`);

      return sum + CREDENTIAL_FIXED_SIZE + (credential.config.length - 2) / 2 + (credential.salt === undefined ? 0 : SALT_SIZE);
    }, total + CLAUSE_HEADER_SIZE);
  }, HEADER_SIZE);
}

/** Writes the configuration's big-endian bytes; throws a TypeError or RangeError on a field outside its width. */
export function serializeConfigurationBytes(configuration: Configuration): Uint8Array<ArrayBuffer> {
  assertObject(configuration, 'configuration');

  const { wait, ignoresPause } = configuration;

  assertUintNumber(wait, FORMATS_WAIT_BITS, 'configuration.wait');
  assertBool(ignoresPause, 'configuration.ignoresPause');

  const clauses = (checkElements(configuration.clauses, 'configuration.clauses') as readonly Clause[]).map(
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
  putUint(FLAG_SIZE, ignoresPause ? 1 : 0);
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
