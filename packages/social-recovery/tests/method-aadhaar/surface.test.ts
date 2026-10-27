import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src';
import * as constants from '../../src/constants/method-aadhaar';
import * as recoveryMethods from '../../src/recovery-methods';
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

describe('the pre-prover time read surface', () => {
  it('the stack may carry an optional signedAt from the QR string to a bigint or undefined', () => {
    expectTypeOf<AnonAadhaarStack['signedAt']>().toEqualTypeOf<((qrData: string) => Promise<bigint | undefined>) | undefined>();
  });

  it('the slack past the window is zero seconds, as a bigint: the read is the circuit\'s own hour-truncated time', () => {
    expect(constants.METHOD_AADHAAR_SIGNED_AT_SLACK).toBe(0n);
  });

  it('the time calls are the peer\'s three helpers, frozen, and distinct from the calls init needs', () => {
    expect([...constants.METHOD_AADHAAR_STACK_TIME_CALLS]).toEqual(['timestampToUTCUnix', 'decompressByteArray', 'convertBigIntToByteArray']);
    expect(Object.isFrozen(constants.METHOD_AADHAAR_STACK_TIME_CALLS)).toBe(true);
    expect([...constants.METHOD_AADHAAR_STACK_CALLS]).toEqual(['init', 'generateArgs', 'prove', 'verify']);
  });
});

describe('the changesets', () => {
  const own = readFileSync(join(REPO_ROOT, '.changeset', 'social-recovery-method-aadhaar.md'), 'utf8');
  const modes = readFileSync(join(REPO_ROOT, '.changeset', 'identity-test-modes.md'), 'utf8');
  const followUpsPath = join(REPO_ROOT, '.changeset', 'extension-follow-ups.md');
  const followUps = existsSync(followUpsPath) ? readFileSync(followUpsPath, 'utf8') : '';
  const changeset = `${own}\n${modes}\n${followUps}`;

  it('the method\'s own and the test-mode one are each a patch for the package', () => {
    expect(own).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
    expect(modes).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
  });

  it('both changesets say the METHOD_AADHAAR_* constants come from both entries, and the second entry now carries them', () => {
    const second = recoveryMethods as { readonly [name: string]: unknown };

    expect(modes).toContain('Every `METHOD_AADHAAR_*` constant is now exported from the core entry as well as from `./recovery-methods`.');
    expect(own).toContain('the `METHOD_AADHAAR_*` constants are exported from both entries');

    for (const [name, value] of Object.entries(constants)) {
      expect(second[name], name).toBe(value);
      expect((core as { readonly [name: string]: unknown })[name], name).toBe(value);
    }
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
