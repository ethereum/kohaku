import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../helpers/source';

const notes = readFileSync(join(PACKAGE_ROOT, 'CHANGELOG.md'), 'utf8').split(/^## 0\.0\.2\s*$/m)[1]?.split(/^## /m)[0] ?? '';
const text = notes.split(/(?=^- )/m).find((entry) => entry.includes("The setup client's `validateSetup` and `describeSetup` now read the account's fallback handler")) ?? '';

/** The public names the handler disclosure adds, each to be named in its release note. */
const NAMES = [
  'SetupDescription',
  'fallbackHandler',
  'DescribedFallbackHandler',
  'ActionReads',
  'fallbackHandlerEntry',
  'account.fallback-handler',
  'RECOVERY_ACTION_FALLBACK_HANDLER_SLOT',
  'RECOVERY_ACTION_PRIVILEGES_ABI',
  'RECOVERY_ACTION_WORD_RETURN_ABI',
];

describe('the fallback handler release note', () => {
  it('appears in the package patch notes', () => {
    expect(notes).toMatch(/#### Patch Changes[\s\S]*The setup client's `validateSetup` and `describeSetup` now read the account's fallback handler/);
  });

  it.each(NAMES)('names %s', (name) => {
    expect(text).toContain(name);
  });

  it('carries no Breaking line, the new members being optional', () => {
    expect(text).not.toMatch(/Breaking/);
  });

  it('states the extra eth_call and that a recovery leaves the handler in place', () => {
    expect(text).toMatch(/eth_call/);
    expect(text.split('\n').some((line) => /recover/i.test(line) && /handler/i.test(line) && /in place|leaves|remains|untouched|survives/i.test(line))).toBe(true);
  });
});
