import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { aliasTypes, fixtureProgram, loadRecords, type RecordContext, RECORDS_ROOT, visitType } from '../helpers/records';
import { hasModifier, listSourceFiles, parseSource, requireSourceFile, toPackagePath, walk } from '../helpers/source';

// D-201 (design/offchain/sdk.md) makes every record the frozen members take
// and return a value: line 532 "the records the frozen members return ...
// each frozen with the member that returns it", line 549 "a record with no
// members of its own" for the prepared call, and the brief's test expectation
// "Every record is a type alias or interface-free object type with no method
// members (compiler API walk: no MethodSignature, no function-typed property
// on a record)".

/** Syntax that declares a call anywhere in a type: a method, a call or construct signature, a function type. */
const CALL_SYNTAX = new Set([
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.ConstructorType,
]);

/** Every path under a type that is callable or reached through a method signature. */
function callablePaths(checker: ts.TypeChecker, type: ts.Type, name: string): string[] {
  const found = new Set<string>();

  visitType(
    checker,
    type,
    (reached, path, via) => {
      const isMethod = via?.declarations?.some((node) => ts.isMethodSignature(node) || ts.isMethodDeclaration(node));

      if (isMethod === true) found.add(`${path} (method signature)`);

      if (checker.getSignaturesOfType(reached, ts.SignatureKind.Call).length > 0) found.add(`${path} (callable)`);

      if (checker.getSignaturesOfType(reached, ts.SignatureKind.Construct).length > 0) {
        found.add(`${path} (constructable)`);
      }
    },
    name,
  );

  return [...found].sort();
}

describe('the callable-member detector', () => {
  const { checker, sourceFile } = fixtureProgram(`
    type Callback = (value: string) => void;
    export type WithMethod = { readonly kind: 'a'; describe(): string };
    export type WithFunctionProperty = { readonly run: () => void };
    export type WithAliasedFunction = { readonly done?: Callback };
    export type WithNestedFunction = { readonly calls: readonly { readonly target: string; readonly go: Callback }[] };
    export type WithUnionFunction = { readonly value: string | (() => string) };
    export type WithConstructor = { readonly make: new () => object };
    export type Callable = { (input: string): string };
    export type Plain = {
      readonly kind: 'plain';
      readonly list: readonly { readonly n: number; readonly tags: readonly string[] }[];
      readonly open: { readonly [name: string]: unknown };
      readonly maybe?: bigint;
    };
  `);
  const types = aliasTypes(checker, sourceFile);
  const judge = (name: string): string[] => callablePaths(checker, types.get(name) as ts.Type, name);

  it.each([
    'WithMethod',
    'WithFunctionProperty',
    'WithAliasedFunction',
    'WithNestedFunction',
    'WithUnionFunction',
    'WithConstructor',
    'Callable',
  ])('flags %s', (name) => {
    expect(judge(name).length).toBeGreaterThan(0);
  });

  it('passes a plain record, arrays and open index signatures included', () => {
    expect(judge('Plain')).toEqual([]);
  });
});

describe('src/interfaces/records/', () => {
  const files = listSourceFiles(RECORDS_ROOT);
  let context: RecordContext;

  beforeAll(() => {
    context = loadRecords();
  });

  it('holds record files to judge', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((path): [string, string] => [toPackagePath(path), path]))(
    '%s declares no interface, class, function or call syntax',
    (_label, path) => {
      const found: string[] = [];
      const sourceFile = parseSource(path);

      walk(sourceFile, (node) => {
        const isDeclaration =
          ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isClassExpression(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node);

        if (isDeclaration || CALL_SYNTAX.has(node.kind)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

          found.push(`${toPackagePath(path)}:${line + 1} ${ts.SyntaxKind[node.kind]}`);
        }
      });

      expect(found).toEqual([]);
    },
  );

  it('declares type aliases to judge', () => {
    const count = files.reduce(
      (total, path) => total + aliasTypes(context.checker, requireSourceFile(context.program, path)).size,
      0,
    );

    expect(count).toBeGreaterThan(0);
  });

  it.each(files.map((path): [string, string] => [toPackagePath(path), path]))(
    'every type alias in %s is a value: no method signature and no function-typed property at any depth',
    (_label, path) => {
      const types = aliasTypes(context.checker, requireSourceFile(context.program, path));
      const found = [...types].flatMap(([name, type]) => callablePaths(context.checker, type, name));

      expect(found).toEqual([]);
    },
  );

  it.each(files.map((path): [string, string] => [toPackagePath(path), path]))(
    'every type alias %s exports reaches the core entry as the same declaration',
    (_label, path) => {
      const missing: string[] = [];

      for (const statement of requireSourceFile(context.program, path).statements) {
        if (!ts.isTypeAliasDeclaration(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

        const exported = context.entry.get(statement.name.text);

        if (exported?.declarations?.includes(statement) !== true) missing.push(statement.name.text);
      }

      expect(missing).toEqual([]);
    },
  );
});
