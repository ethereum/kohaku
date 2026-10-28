import { beforeAll, describe, expect, it } from 'vitest';
import * as entry from '../../src/index';
import { loadRecords, type RecordContext } from '../helpers/records';

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

describe('the backup surface the core entry exports', () => {
  it.for([
    'BACKUP_HEX_BODY',
    'BACKUP_METHOD_SIZE',
    'BACKUP_MAX_UINT16',
    'BACKUP_MAX_THRESHOLD',
    'BACKUP_MAX_WAIT',
    'BACKUP_MAX_SETUP_NONCE',
    'ClauseBytes',
    'CredentialBytes',
    'ParsedConfiguration',
  ])('no longer exports %s, as a value or a type', (name) => {
    expect(context.entry.has(name)).toBe(false);
    expect(name in entry).toBe(false);
  });

  it.for([
    'BACKUP_BYTE_BITS',
    'BACKUP_UINT16_BITS',
    'BACKUP_ASSOCIATED_DATA_ABI',
    'BACKUP_PAYLOAD_VERSION_BITS',
    'BACKUP_LONE_SURROGATE_PATTERN',
  ])('exports %s', (name) => {
    expect(context.entry.has(name)).toBe(true);
    expect(name in entry).toBe(true);
  });

  it('keeps the four backup functions and the record types they take', () => {
    for (const name of ['Configuration', 'Clause', 'Credential', 'BackupAuthenticated']) expect(context.entry.has(name)).toBe(true);

    for (const name of ['sealBackup', 'openBackup', 'serializeConfiguration', 'deserializeConfiguration']) {
      expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
