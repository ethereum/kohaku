import { join } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { RequestDescription } from '../../src/index';
import { compileProbes, PROBE_IMPORT_FROM } from '../helpers/probe';
import {
  exportedType,
  hasFlag,
  isOptional,
  isTypeAlias,
  loadRecords,
  propertyNames,
  propertyType,
  RECORDS_ROOT,
  type RecordContext,
  visitType,
} from '../helpers/records';
import { requireSourceFile, resolveExports } from '../helpers/source';

// D-205 line 1134: `identityPublic` is "that submission publishes this
// credential's method, config and salt on chain", a disclosure. Line 1151:
// "Salts never enter a description." So the row states that the salt is
// published without carrying it, and no description record has a salt field.

const DESCRIPTION_FILES = ['descriptions.ts', 'setup-description.ts'];

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

/** Every type alias a records file exports, by name. */
function exportedAliases(file: string): Map<string, ts.Type> {
  const sourceFile = requireSourceFile(context.program, join(RECORDS_ROOT, file));
  const aliases = new Map<string, ts.Type>();

  for (const [name, symbol] of resolveExports(context.checker, sourceFile)) {
    if (isTypeAlias(symbol)) aliases.set(name, context.checker.getDeclaredTypeOfSymbol(symbol));
  }

  return aliases;
}

/** The paths, below a root, of every property named `salt` reachable from it. */
function saltPaths(root: ts.Type, rootPath: string): string[] {
  const found: string[] = [];

  visitType(context.checker, root, (_type, path, via) => {
    if (via?.getName() === 'salt') found.push(path);
  }, rootPath);

  return [...new Set(found)];
}

describe('identityPublic discloses the salt without carrying it (D-205 lines 1134, 1151)', () => {
  const identityPublic = (): ts.Type => propertyType(context.checker, exportedType(context, 'RequestDescription'), 'identityPublic');

  let probes: Map<string, string[]>;

  beforeAll(() => {
    const header = `import type { RequestDescription } from '${PROBE_IMPORT_FROM}';\n`;
    const method = "method: '0x00000000000000000000000000000000000000a1'";

    probes = compileProbes({
      'identity-public': `${header}export const row: RequestDescription['identityPublic'] = { ${method}, config: '0x01', saltPublished: true };\n`,
      'identity-public-salt': `${header}export const row: RequestDescription['identityPublic'] = { ${method}, config: '0x01', saltPublished: true, salt: '0x02' };\n`,
      'identity-public-false': `${header}export const row: RequestDescription['identityPublic'] = { ${method}, config: '0x01', saltPublished: false };\n`,
      'identity-public-missing': `${header}export const row: RequestDescription['identityPublic'] = { ${method}, config: '0x01' };\n`,
    });
  });

  const errorsOf = (name: string): string[] => {
    const errors = probes.get(name);

    if (errors === undefined) throw new Error(`no probe ${name}`);

    return errors;
  };

  it('has exactly method, config and saltPublished, each required', () => {
    const row = identityPublic();

    expect(propertyNames(context.checker, row)).toEqual(['config', 'method', 'saltPublished']);
    expect(context.checker.getIndexInfosOfType(row)).toHaveLength(0);

    for (const name of ['config', 'method', 'saltPublished']) expect(isOptional(context.checker, row, name), name).toBe(false);
  });

  it('saltPublished is the literal true', () => {
    const published = propertyType(context.checker, identityPublic(), 'saltPublished');

    expect(hasFlag(published, ts.TypeFlags.BooleanLiteral)).toBe(true);
    expect(context.checker.typeToString(published)).toBe('true');
    expectTypeOf<RequestDescription['identityPublic']['saltPublished']>().toEqualTypeOf<true>();
    expect(errorsOf('identity-public')).toEqual([]);
    expect(errorsOf('identity-public-false').join('\n')).toMatch(/TS2322: Type 'false' is not assignable to type 'true'/);
    expect(errorsOf('identity-public-missing').join('\n')).toMatch(/TS2741: .*'saltPublished'/);
  });

  it('a row carrying salt is rejected', () => {
    expectTypeOf<RequestDescription['identityPublic']>().not.toHaveProperty('salt');
    expect(errorsOf('identity-public-salt').join('\n')).toMatch(/TS2353: .*'salt' does not exist/);
  });
});

describe('no description record has a salt field (D-205 line 1151)', () => {
  it('the walk finds a salt where one stands: Credential and SetupDraft carry the holder\'s salt', () => {
    expect(saltPaths(exportedType(context, 'Credential'), 'Credential')).toEqual(['Credential.salt']);
    expect(saltPaths(exportedType(context, 'SetupDraft'), 'SetupDraft')).toEqual(['SetupDraft.clauses[].credentials[].salt']);
  });

  it('the walk covers the three descriptions the chapter names', () => {
    const names = DESCRIPTION_FILES.flatMap((file) => [...exportedAliases(file).keys()]);

    expect(names).toEqual(expect.arrayContaining(['RequestDescription', 'StatusDescription', 'SetupDescription']));
  });

  it.each(DESCRIPTION_FILES)('no type %s exports reaches a property named salt', (file) => {
    const aliases = exportedAliases(file);

    expect(aliases.size).toBeGreaterThan(0);

    const found = [...aliases].flatMap(([name, type]) => saltPaths(type, name));

    expect(found).toEqual([]);
  });
});
