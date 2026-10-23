import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src';
import * as constants from '../../src/constants/method-aadhaar';
import { anonAadhaarMethod, type AnonAadhaarMethodOptions, type AnonAadhaarStack } from '../../src/method-aadhaar';
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

describe('the test mode surface', () => {
  it('the default test mode is off and is exported from the core entry', () => {
    expect(constants.METHOD_AADHAAR_DEFAULT_TEST_MODE).toBe(false);
    expect((core as { readonly [name: string]: unknown })['METHOD_AADHAAR_DEFAULT_TEST_MODE']).toBe(false);
  });

  it('the options carry an optional boolean testMode, and the stack\'s verify takes it second', () => {
    expectTypeOf<AnonAadhaarMethodOptions['testMode']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Parameters<AnonAadhaarStack['verify']>>().toEqualTypeOf<[pcd: Parameters<AnonAadhaarStack['verify']>[0], testMode?: boolean]>();
  });
});

describe('the changesets', () => {
  const own = readFileSync(join(REPO_ROOT, '.changeset', 'social-recovery-method-aadhaar.md'), 'utf8');
  const modes = readFileSync(join(REPO_ROOT, '.changeset', 'identity-test-modes.md'), 'utf8');
  const changeset = `${own}\n${modes}`;

  it('the method\'s own and the test-mode one are each a patch for the package', () => {
    expect(own).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
    expect(modes).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
  });

  it('the test-mode changeset names the option', () => {
    expect(modes).toContain('testMode');
  });

  it('names every public export this method adds to either entry', () => {
    const names = publicAadhaarNames();
    const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(changeset));

    expect(names).toContain('anonAadhaarMethod');
    expect(missing).toEqual([]);
  }, 60_000);
});
