import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  aliasTypes,
  fixtureProgram,
  hasFlag,
  isTypeAlias,
  loadRecords,
  propertyNames,
  propertyType,
  type RecordContext,
  visitType,
} from '../helpers/records';
import { INTERFACES_ROOT, listSourceFiles, parseSource, SRC_ROOT, toPackagePath, walk } from '../helpers/source';

/** The record names the core entry exported at e519820; two were since renamed to stop shadowing DOM globals. */
const PT017_NAMES = [
  'AccountFilterOptions', 'ActionInfo', 'ActionState', 'AddResult', 'Address', 'Assessment', 'Attempt',
  'AttemptRequest', 'BlockHeader', 'BlockRange', 'BlockTag', 'CancelRequest', 'ClientConfiguration',
  'Configuration', 'ConfigurationSource', 'Ctx', 'DeploymentDescriptor', 'DeviceBinding', 'DeviceFacts', 'Domain',
  'EnrollFailure', 'EnrollInput', 'ErrorAbi', 'Fields', 'FilterSpec', 'Gathering', 'Handover', 'Hex', 'Input',
  'Material', 'Moment', 'ModuleInfo', 'Notification', 'Params', 'Parties', 'PaymentOrder', 'PreparedBatch',
  'PreparedCall', 'PrepareOptions', 'RawLog', 'ReadResult', 'RecoveryState', 'Reply', 'ReplyFailure', 'Request',
  'RequestDescription', 'RestoreCause', 'Selection', 'SetupConfirmation', 'SetupDescription', 'SetupDraft',
  'SetupState', 'StatusDescription', 'ValidationResult', 'ValidityWindow', 'Verdict',
] as const;

const RENAMED: Readonly<Record<string, string>> = { Request: 'ApproverRequest', Notification: 'KitNotification' };

const currentName = (name: string): string => RENAMED[name] ?? name;

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

/** Every type alias the core entry exports, by name. */
const exportedAliases = (): [string, ts.Symbol][] =>
  [...context.entry].filter(([, symbol]) => isTypeAlias(symbol)).sort(([a], [b]) => a.localeCompare(b));

describe('src/ without placeholders', () => {
  const files = listSourceFiles(SRC_ROOT);

  it('holds files to judge', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('names no identifier Placeholder in any file', () => {
    const found: string[] = [];

    for (const path of files) {
      const sourceFile = parseSource(path);

      walk(sourceFile, (node) => {
        if (ts.isIdentifier(node) && node.text === 'Placeholder') {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

          found.push(`${toPackagePath(path)}:${line + 1}`);
        }
      });
    }

    expect(found).toEqual([]);
  });

  it('carries the word Placeholder nowhere, comments and strings included', () => {
    const found = files
      .filter((path) => /\bPlaceholder\b/.test(readFileSync(path, 'utf8')))
      .map((path) => toPackagePath(path));

    expect(found).toEqual([]);
  });

  it('keeps no src/interfaces/records.ts beside the records/ folder', () => {
    expect(files.map((path) => toPackagePath(path))).not.toContain('src/interfaces/records.ts');
  });
});

describe('the earlier placeholder record names', () => {
  it('lists 56 distinct names', () => {
    expect(new Set(PT017_NAMES).size).toBe(56);
  });

  it.each(PT017_NAMES.map((name) => [name, currentName(name)]))(
    '%s is exported from the core entry as the type %s',
    (_old, name) => {
      const symbol = context.entry.get(name);

      expect(symbol, `${name} is not exported from src/index.ts`).toBeDefined();
      expect(symbol !== undefined && isTypeAlias(symbol)).toBe(true);
    },
  );

  it.each(Object.keys(RENAMED))('the DOM-shadowing name %s is no longer exported', (name) => {
    expect(context.entry.has(name)).toBe(false);
  });
});

/** Whether every declaration of a property lives in a TypeScript lib file or under node_modules, a type the SDK does not own. */
function isLibraryOwned(property: ts.Symbol): boolean {
  const declarations = property.declarations ?? [];

  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const sourceFile = declaration.getSourceFile();

      return sourceFile.hasNoDefaultLib || sourceFile.fileName.split('/').includes('node_modules');
    })
  );
}

/** The property keys of the well-known symbols, each taken from the unique symbol type the global Symbol carries. */
function wellKnownSymbolKeys(checker: ts.TypeChecker): Set<ts.__String> {
  const symbolConstructor = checker.resolveName('Symbol', undefined, ts.SymbolFlags.Value, false);

  if (symbolConstructor === undefined) throw new Error('the global Symbol does not resolve');

  const keys = new Set<ts.__String>();

  for (const property of checker.getPropertiesOfType(checker.getTypeOfSymbol(symbolConstructor))) {
    const type = checker.getTypeOfSymbol(property);

    if (hasFlag(type, ts.TypeFlags.UniqueESSymbol)) keys.add((type as ts.UniqueESSymbolType).escapedName);
  }

  return keys;
}

/** The paths under a type that reach a symbol-keyed property the SDK owns and no well-known symbol keys, the key a brand hides behind. */
function brandPaths(checker: ts.TypeChecker, type: ts.Type, name: string): string[] {
  const wellKnown = wellKnownSymbolKeys(checker);
  const paths: string[] = [];

  visitType(
    checker,
    type,
    (_type, path, via) => {
      if (via === undefined || isLibraryOwned(via)) return;

      if (via.getName().startsWith('__@') && !wellKnown.has(via.escapedName)) paths.push(path);
    },
    name,
  );

  return paths;
}

/** The paths under a type where a property the SDK owns reaches any, or unknown other than as an open index signature's value. */
function vaguePaths(checker: ts.TypeChecker, type: ts.Type, name: string): string[] {
  const paths: string[] = [];

  visitType(
    checker,
    type,
    (reached, path, via) => {
      if (via !== undefined && isLibraryOwned(via)) return;

      if (hasFlag(reached, ts.TypeFlags.Any)) paths.push(`${path}: any`);

      if (hasFlag(reached, ts.TypeFlags.Unknown) && !path.endsWith('[key]')) paths.push(`${path}: unknown`);
    },
    name,
  );

  return paths;
}

describe('the brand detector', () => {
  const { checker, sourceFile } = fixtureProgram(`
    declare const brand: unique symbol;
    type Placeholder<Name extends string> = { readonly [brand]: Name };
    export type Branded = Placeholder<'Branded'>;
    export type Nested = { readonly inner: readonly Placeholder<'Inner'>[] };
    export type Plain = { readonly kind: 'plain'; readonly value: string };
    export type Tagged = { readonly kind: 'tagged'; readonly [Symbol.toStringTag]: 'Tagged' };
    export type Bytes = { readonly method: Uint8Array };
    declare const iterator: unique symbol;
    export type Disguised = { readonly [iterator]: 'Disguised' };
  `);
  const types = aliasTypes(checker, sourceFile);
  const judge = (name: string): string[] => brandPaths(checker, types.get(name) as ts.Type, name);

  it('flags a brand at the top and inside an array, and passes a plain record', () => {
    expect(judge('Branded')).toHaveLength(1);
    expect(judge('Nested')).toHaveLength(1);
    expect(judge('Plain')).toEqual([]);
  });

  it('passes a well-known symbol key on a type the fixture owns', () => {
    expect(propertyNames(checker, types.get('Tagged') as ts.Type).some((key) => key.startsWith('__@'))).toBe(true);
    expect(judge('Tagged')).toEqual([]);
  });

  it('passes the symbol-keyed members of a Uint8Array a record reaches', () => {
    const method = propertyType(checker, types.get('Bytes') as ts.Type, 'method');

    expect(propertyNames(checker, method).some((key) => key.startsWith('__@'))).toBe(true);
    expect(judge('Bytes')).toEqual([]);
  });

  it('still flags a brand whose own symbol is named like a well-known one', () => {
    expect(judge('Disguised')).toHaveLength(1);
  });

  it('flags a brand keyed through a local binding that shadows Symbol', () => {
    const shadowed = fixtureProgram(`
      declare const Symbol: { readonly iterator: unique symbol };
      export type Shadowed = { readonly [Symbol.iterator]: 'Shadowed' };
    `);
    const type = aliasTypes(shadowed.checker, shadowed.sourceFile).get('Shadowed') as ts.Type;

    expect(brandPaths(shadowed.checker, type, 'Shadowed')).toHaveLength(1);
  });
});

describe('the vague-type detector', () => {
  const { checker, sourceFile } = fixtureProgram(`
    export type Loose = { readonly value: any };
    export type Closed = { readonly value: unknown };
    export type Open = { readonly extra: { readonly [key: string]: unknown } };
    export type Cancellable = { readonly signal: AbortSignal };
  `);
  const types = aliasTypes(checker, sourceFile);
  const judge = (name: string): string[] => vaguePaths(checker, types.get(name) as ts.Type, name);

  it('flags any and a bare unknown on a type the fixture owns, and passes unknown as an open index value', () => {
    expect(judge('Loose')).toEqual(['Loose.value: any']);
    expect(judge('Closed')).toEqual(['Closed.value: unknown']);
    expect(judge('Open')).toEqual([]);
  });

  it('does not judge the members of a library type a record reaches', () => {
    const signal = propertyType(checker, types.get('Cancellable') as ts.Type, 'signal');

    expect(hasFlag(propertyType(checker, signal, 'reason'), ts.TypeFlags.Any)).toBe(true);
    expect(judge('Cancellable')).toEqual([]);
  });
});

describe('every record type the core entry exports', () => {
  it('holds records to judge, at least the 56 earlier names', () => {
    expect(exportedAliases().length).toBeGreaterThanOrEqual(56);
  });

  it('resolves to a concrete type, never any, unknown or never, nor a union holding one', () => {
    const vague: string[] = [];

    for (const [name, symbol] of exportedAliases()) {
      const type = context.checker.getDeclaredTypeOfSymbol(symbol);
      const members = type.isUnion() ? type.types : [type];

      for (const member of members) {
        if (hasFlag(member, ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
          vague.push(`${name}: ${context.checker.typeToString(type)}`);
        }
      }
    }

    expect(vague).toEqual([]);
  });

  it('carries no symbol-keyed brand property at any depth, the shape of the earlier Placeholder', () => {
    const branded = exportedAliases().flatMap(([name, symbol]) =>
      brandPaths(context.checker, context.checker.getDeclaredTypeOfSymbol(symbol), name),
    );

    expect(branded).toEqual([]);
  });

  it('reaches no any anywhere inside it, and unknown only as the value of an open index signature', () => {
    const vague = exportedAliases().flatMap(([name, symbol]) =>
      vaguePaths(context.checker, context.checker.getDeclaredTypeOfSymbol(symbol), name),
    );

    expect(vague).toEqual([]);
  });
});

describe('the thirteen interface files', () => {
  const interfaceFiles = listSourceFiles(INTERFACES_ROOT).filter((path) => dirname(path) === INTERFACES_ROOT);

  it('are found beside the records folder', () => {
    expect(interfaceFiles.length).toBeGreaterThanOrEqual(12);
  });

  it('invent no field: no member signature writes an object type of its own', () => {
    const inventions: string[] = [];

    for (const path of interfaceFiles) {
      const sourceFile = parseSource(path);

      walk(sourceFile, (node) => {
        if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

          inventions.push(`${toPackagePath(path)}:${line + 1} ${node.getText(sourceFile)}`);
        }
      });
    }

    expect(inventions).toEqual([]);
  });

  it('declare no type alias, leaving every record to src/interfaces/records/', () => {
    const declared: string[] = [];

    for (const path of interfaceFiles) {
      for (const statement of parseSource(path).statements) {
        if (ts.isTypeAliasDeclaration(statement)) declared.push(`${toPackagePath(path)}: type ${statement.name.text}`);
      }
    }

    expect(declared).toEqual([]);
  });
});
