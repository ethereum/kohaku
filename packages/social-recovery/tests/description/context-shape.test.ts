import { beforeAll, describe, expect, it } from 'vitest';
import { compileProbes, PROBE_IMPORT_FROM } from '../helpers/probe';

const HEADER = `import type { MethodDescriptionReads, SetupDescriptionContext } from '${PROBE_IMPORT_FROM}';\n`;
const MODULE = "module: '0x00000000000000000000000000000000000000a1'";
const READS = `${MODULE}, moduleInfo: { answered: false }, trustedParties: { answered: false }, paused: { answered: false }, implemented: true`;

let probes: Map<string, string[]>;

beforeAll(() => {
  probes = compileProbes({
    'description-reads': `${HEADER}export const reads: MethodDescriptionReads = { ${READS} };\n`,
    'description-reads-pause-holder': `${HEADER}export const reads: MethodDescriptionReads = { ${READS}, pauseHolder: { answered: false } };\n`,
    'description-context-state-of': `${HEADER}export const stateOf: SetupDescriptionContext extends { readonly stateOf: unknown } ? true : false = false;\n`,
  });
});

const errorsOf = (name: string): string => {
  const errors = probes.get(name);

  if (errors === undefined) throw new Error(`no probe ${name}`);

  return errors.join('\n');
};

describe('the setup description context\'s shape', () => {
  it('takes a method\'s reads without any pause-holder read of its own', () => {
    expect(errorsOf('description-reads')).toBe('');
  });

  it('refuses a separate pauseHolder read on a method', () => {
    expect(errorsOf('description-reads-pause-holder')).toMatch(/TS2353: .*'pauseHolder' does not exist/);
  });

  it('carries no stateOf read', () => {
    expect(errorsOf('description-context-state-of')).toBe('');
  });
});
