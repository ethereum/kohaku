import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as constants from '../../src/constants/method-aadhaar';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { REPO_ROOT, SRC_ROOT, createSourceProgram, requireSourceFile, resolveExports, toPackagePath } from '../helpers/source';
import { stackDouble } from './fixtures';

const AADHAAR_FILES = [/^src\/method-aadhaar\//, /^src\/constants\/method-aadhaar\.ts$/, /^src\/types\/method-aadhaar\.ts$/];

/** Every name a public entry exports whose declaration lives in this method's files. */
function publicAadhaarNames(): string[] {
  const program = createSourceProgram();
  const checker = program.getTypeChecker();
  const names = new Set<string>();

  for (const entry of ['index.ts', join('recovery-methods', 'index.ts')]) {
    for (const [name, symbol] of resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, entry)))) {
      const files = (symbol.declarations ?? []).map((declaration) => toPackagePath(declaration.getSourceFile().fileName));

      if (files.some((file) => AADHAAR_FILES.some((pattern) => pattern.test(file)))) names.add(name);
    }
  }

  return [...names].sort();
}

describe('the frozen values', () => {
  it('vector is frozen', () => {
    expect(Object.isFrozen(anonAadhaarMethod({ stack: stackDouble().stack }).vector)).toBe(true);
  });

  it('every exported failure or record constant of the method is frozen', () => {
    const records = Object.entries(constants).filter(
      ([name, value]) => typeof value === 'object' && value !== null && !(value instanceof RegExp) && !Array.isArray(value) && !name.endsWith('_ABI'),
    );

    expect(records.length).toBeGreaterThan(0);

    for (const [name, value] of records) expect(Object.isFrozen(value), name).toBe(true);
  });

  it('every exported reply failure of the method is frozen', () => {
    const failures = Object.entries(constants).filter(
      ([, value]) => typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'reply-failure',
    );

    for (const [name, value] of failures) expect(Object.isFrozen(value), name).toBe(true);
  });

  it('the method exports no pattern of its own: hex, decimal and digest checks come from the shared formats', () => {
    const patterns = Object.entries(constants).filter(([, value]) => value instanceof RegExp).map(([name]) => name);

    expect(patterns).toEqual([]);
  });
});

describe('the changeset', () => {
  const changeset = readFileSync(join(REPO_ROOT, '.changeset', 'social-recovery-method-aadhaar.md'), 'utf8');

  it('is one patch for the package', () => {
    expect(changeset).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
  });

  it('names every public export this method adds to either entry', () => {
    const names = publicAadhaarNames();
    const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(changeset));

    expect(names).toContain('anonAadhaarMethod');
    expect(missing).toEqual([]);
  }, 60_000);
});
