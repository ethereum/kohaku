import {
  BACKUP_ADDRESS_SIZE as ADDRESS_SIZE,
  BACKUP_COUNT_SIZE as COUNT_SIZE,
  BACKUP_FLAG_SIZE as FLAG_SIZE,
  BACKUP_LENGTH_SIZE as LENGTH_SIZE,
  BACKUP_SALT_ABSENT as SALT_ABSENT,
  BACKUP_SALT_PRESENT as SALT_PRESENT,
  BACKUP_SALT_SIZE as SALT_SIZE,
  BACKUP_THRESHOLD_SIZE as THRESHOLD_SIZE,
  BACKUP_WAIT_SIZE as WAIT_SIZE,
} from '../constants';
import type { Clause, Configuration, Credential, Hex } from '../interfaces';
import type { ParsedConfiguration } from '../types';
import { bytesToHex, hexToBytes, readUint } from './hex';

/** Parses a configuration from the front of `bytes`; throws a RangeError on bytes that do not parse. */
export function parseConfigurationBytes(bytes: Uint8Array): ParsedConfiguration {
  let offset = 0;
  const take = (size: number): Uint8Array => {
    if (offset + size > bytes.length) throw new RangeError('configuration bytes end inside a field');

    const slice = bytes.subarray(offset, offset + size);

    offset += size;

    return slice;
  };
  const uint = (size: number): number => Number(readUint(take(size), 0, size));
  const wait = uint(WAIT_SIZE);
  const pauseFlag = uint(FLAG_SIZE);

  if (pauseFlag > 1) throw new RangeError('configuration ignoresPause byte is neither 0x00 nor 0x01');

  const clauses: Clause[] = [];
  const clauseCount = uint(COUNT_SIZE);

  for (let clauseIndex = 0; clauseIndex < clauseCount; clauseIndex += 1) {
    const threshold = uint(THRESHOLD_SIZE);
    const credentialCount = uint(COUNT_SIZE);
    const credentials: Credential[] = [];

    for (let credentialIndex = 0; credentialIndex < credentialCount; credentialIndex += 1) {
      const method = bytesToHex(take(ADDRESS_SIZE));
      const config = bytesToHex(take(uint(LENGTH_SIZE)));
      const saltFlag = uint(FLAG_SIZE);

      if (saltFlag === SALT_ABSENT) {
        credentials.push({ method, config });
      } else if (saltFlag === SALT_PRESENT) {
        credentials.push({ method, config, salt: bytesToHex(take(SALT_SIZE)) });
      } else {
        throw new RangeError('configuration salt flag is neither 0x00 nor 0x01');
      }
    }

    clauses.push({ threshold, credentials });
  }

  return { configuration: { clauses, wait, ignoresPause: pauseFlag === 1 }, length: offset };
}

/**
 * Inverts `serializeConfiguration`, throwing a RangeError on trailing bytes.
 * Hex comes back lowercase, with no label and only the salts the holder supplied.
 */
export function deserializeConfiguration(serialized: Hex): Configuration {
  const bytes = hexToBytes(serialized, 'serialized configuration');
  const parsed = parseConfigurationBytes(bytes);

  if (parsed.length !== bytes.length) throw new RangeError('configuration bytes carry trailing bytes');

  return parsed.configuration;
}
