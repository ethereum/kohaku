import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasModifier, listSourceFiles, parseSource, SRC_ROOT, toPackagePath, walk } from '../helpers/source';

// D-200 (design/offchain/sdk.md line 46): the source keeps to the syntax node
// runs by stripping types, so it uses no enum, namespace or parameter property.

const PARAMETER_PROPERTY_MODIFIERS = [
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.OverrideKeyword,
];

/** Every enum, namespace or module declaration and constructor parameter property in one file. */
function forbiddenSyntax(sourceFile: ts.SourceFile): string[] {
  const found: string[] = [];
  const at = (node: ts.Node): string => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return `${sourceFile.fileName}:${line + 1}`;
  };

  walk(sourceFile, (node) => {
    if (ts.isEnumDeclaration(node)) found.push(`${at(node)} enum ${node.name.text}`);

    if (ts.isModuleDeclaration(node)) found.push(`${at(node)} namespace or module ${node.name.getText(sourceFile)}`);

    const isParameterProperty =
      ts.isParameter(node) &&
      ts.isConstructorDeclaration(node.parent) &&
      PARAMETER_PROPERTY_MODIFIERS.some((kind) => hasModifier(node, kind));

    if (isParameterProperty) found.push(`${at(node)} parameter property ${node.name.getText(sourceFile)}`);
  });

  return found;
}

const fixture = (text: string): ts.SourceFile =>
  ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true);

describe('the syntax rule detector', () => {
  it.each([
    ['an enum', 'export enum Kind { A }'],
    ['a const enum', 'const enum Kind { A }'],
    ['a declared enum', 'declare enum Kind { A }'],
    ['a namespace', 'export namespace Kit { export const a = 1; }'],
    ['a type-only namespace', 'namespace Kit { export type A = string; }'],
    ['a legacy module', 'module Kit { }'],
    ['an ambient module', "declare module 'kit' { }"],
    ['a global augmentation', 'export {}; declare global { }'],
    ['a public parameter property', 'class A { constructor(public a: string) {} }'],
    ['a private parameter property', 'class A { constructor(private a: string) {} }'],
    ['a protected parameter property', 'class A { constructor(protected a: string) {} }'],
    ['a readonly parameter property', 'class A { constructor(readonly a: string) {} }'],
    ['a private readonly parameter property', 'class A { constructor(private readonly a: string) {} }'],
    ['a parameter property in a class expression', 'const A = class { constructor(public a: string) {} };'],
  ])('flags %s', (_label, text) => {
    expect(forbiddenSyntax(fixture(text))).toHaveLength(1);
  });

  it.each([
    ['a plain constructor parameter', 'class A { constructor(a: string) { void a; } }'],
    ['a readonly field', 'class A { readonly a = 1; }'],
    ['a readonly interface member', 'interface A { readonly a: string }'],
    ['a string union', "type Kind = 'a' | 'b';"],
    ['a const object', "const Kind = { A: 'a' } as const;"],
    ['a readonly method parameter type', 'function f(a: readonly string[]) { return a; }'],
  ])('passes %s', (_label, text) => {
    expect(forbiddenSyntax(fixture(text))).toEqual([]);
  });
});

describe('src/**/*.ts', () => {
  const files = listSourceFiles(SRC_ROOT);

  it('holds files to judge', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((path): [string, string] => [toPackagePath(path), path]))(
    '%s uses no enum, namespace, module declaration or parameter property',
    (_label, path) => {
      expect(forbiddenSyntax(parseSource(path))).toEqual([]);
    },
  );
});
