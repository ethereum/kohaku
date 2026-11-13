import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/source';

const PATH = join(REPO_ROOT, '.changeset', 'fallback-handler-disclosure.md');
const text = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';

/** The public names the handler disclosure adds, each to be named in its changeset. */
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

describe('.changeset/fallback-handler-disclosure.md', () => {
  it('exists and is a patch for the package', () => {
    expect(existsSync(PATH)).toBe(true);
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
  });

  it.each(NAMES)('names %s', (name) => {
    expect(text).toContain(name);
  });

  it('carries no Breaking line, the new members being optional', () => {
    expect(text).not.toMatch(/Breaking/);
  });

  it('states the extra eth_call and that a recovery leaves the handler in place', () => {
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');

    expect(body).toMatch(/eth_call/);
    expect(body.split('\n').some((line) => /recover/i.test(line) && /handler/i.test(line) && /in place|leaves|remains|untouched|survives/i.test(line))).toBe(true);
  });
});
