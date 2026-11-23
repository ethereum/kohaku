import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as zkPassportConstants from '../../src/constants/method-zkpassport';
import { PACKAGE_ROOT } from '../helpers/source';

const PATH = join(PACKAGE_ROOT, 'CHANGELOG.md');
const text = existsSync(PATH) ? readFileSync(PATH, 'utf8').split(/^## 0\.0\.2\s*$/m)[1]?.split(/^## /m)[0] ?? '' : '';

/** Public additions from the extension follow-ups, retained in the stable release notes. */
const NAMES = [
  'account.not-deployed',
  'accountHoldsCode',
  'ActionReads',
  'signedAt',
  'AnonAadhaarStack',
  'AadhaarCoreSurface',
  'timestampToUTCUnix',
  'decompressByteArray',
  'convertBigIntToByteArray',
  'METHOD_AADHAAR_STACK_TIME_CALLS',
  'METHOD_AADHAAR_SIGNED_AT_SLACK',
  'zkPassportVersionOf',
  'zkPassportVersionWord',
  'default',
  './recovery-methods',
];

const VERSION_CONSTANTS = Object.keys(zkPassportConstants).filter((name) => name.startsWith('METHOD_ZKPASSPORT_VERSION_'));

describe('stable social-recovery release notes', () => {
  it('contains the 0.0.2 patch release', () => {
    expect(existsSync(PATH)).toBe(true);
    expect(text).toContain('### Patch Changes');
  });

  it.each(NAMES)('names %s', (name) => {
    expect(text).toContain(name);
  });

  it('names every METHOD_ZKPASSPORT_VERSION_* constant, by prefix or one by one', () => {
    expect(VERSION_CONSTANTS.length).toBeGreaterThan(0);

    const byPrefix = text.includes('METHOD_ZKPASSPORT_VERSION_*');

    expect(byPrefix || VERSION_CONSTANTS.every((name) => new RegExp(`\\b${name}\\b`).test(text))).toBe(true);
  });

  it('carries a Breaking line for the required ActionReads member', () => {
    const breaking = text.split('\n').filter((line) => /Breaking/.test(line));

    expect(breaking.some((line) => line.includes('ActionReads') && line.includes('accountHoldsCode'))).toBe(true);
  });

  it('describes the unknown-key change outside test mode: not-judged and handed on, test mode unchanged', () => {
    expect(text).toContain('not-judged');
    expect(text).toMatch(/test mode/i);
    expect(text).toMatch(/2021/);
  });
});
