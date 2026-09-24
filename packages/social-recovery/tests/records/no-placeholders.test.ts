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

/** The well-known ECMAScript symbols a built-in type such as `ReadonlyMap` is keyed on. */
const WELL_KNOWN_SYMBOLS = new Set([
  'asyncDispose', 'asyncIterator', 'dispose', 'hasInstance', 'isConcatSpreadable', 'iterator', 'match', 'matchAll',
  'replace', 'search', 'species', 'split', 'toPrimitive', 'toStringTag', 'unscopables',
]);

/** Whether the property is declared under a key written `[Symbol.<well-known>]`. */
const isWellKnownSymbolKey = (property: ts.Symbol): boolean =>
  (property.declarations ?? []).length > 0 &&
  (property.declarations ?? []).every((declaration) => {
    const key = ts.getNameOfDeclaration(declaration);

    return (
      key !== undefined &&
      ts.isComputedPropertyName(key) &&
      ts.isPropertyAccessExpression(key.expression) &&
      ts.isIdentifier(key.expression.expression) &&
      key.expression.expression.text === 'Symbol' &&
      WELL_KNOWN_SYMBOLS.has(key.expression.name.text)
    );
  });

/** The paths under a type that reach a symbol-keyed property, the key a brand hides behind. */
function brandPaths(checker: ts.TypeChecker, type: ts.Type, name: string): string[] {
  const paths: string[] = [];

  visitType(
    checker,
    type,
    (_type, path, via) => {
      if (via !== undefined && via.getName().startsWith('__@') && !isWellKnownSymbolKey(via)) paths.push(path);
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
    export type Keyed = ReadonlyMap<string, number>;
    export type Tagged = { readonly [Symbol.toStringTag]: string; readonly [Symbol.asyncIterator]: () => void };
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

  it('passes a key that is a well-known symbol, as a ReadonlyMap carries', () => {
    expect(judge('Keyed')).toEqual([]);
    expect(judge('Tagged')).toEqual([]);
  });

  it('still flags a brand whose own symbol is named like a well-known one', () => {
    expect(judge('Disguised')).toHaveLength(1);
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
    const vague: string[] = [];

    for (const [name, symbol] of exportedAliases()) {
      visitType(
        context.checker,
        context.checker.getDeclaredTypeOfSymbol(symbol),
        (type, path) => {
          if (hasFlag(type, ts.TypeFlags.Any)) vague.push(`${path}: any`);

          if (hasFlag(type, ts.TypeFlags.Unknown) && !path.endsWith('[key]')) vague.push(`${path}: unknown`);
        },
        name,
      );
    }

    expect(vague).toEqual([]);
  });
});

describe('the twelve interface files', () => {
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
