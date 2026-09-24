// Reads the package's TypeScript source through the compiler API, so the
// structural tests judge declarations rather than text.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
export const SRC_ROOT = join(PACKAGE_ROOT, 'src');
export const INTERFACES_ROOT = join(SRC_ROOT, 'interfaces');

const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

/** Every TypeScript file under `dir`, recursively, sorted. */
export function listSourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(path));
    } else if (entry.isFile() && TYPESCRIPT_FILE.test(entry.name)) {
      found.push(path);
    }
  }

  return found.sort();
}

/** A path relative to the package root, with forward slashes. */
export function toPackagePath(path: string): string {
  return relative(PACKAGE_ROOT, path).split(sep).join('/');
}

export function parseSource(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Visits `node` and every node below it. */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;

  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/** One program over every file under `src/`, under the package's own compiler options. */
export function createSourceProgram(): ts.Program {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));

  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT);

  return ts.createProgram(listSourceFiles(SRC_ROOT), { ...parsed.options, noEmit: true });
}

export function requireSourceFile(program: ts.Program, path: string): ts.SourceFile {
  const sourceFile = program.getSourceFile(path);

  if (sourceFile === undefined) throw new Error(`not in the program: ${toPackagePath(path)}`);

  return sourceFile;
}

export type InterfaceSite = {
  readonly name: string;
  readonly file: string;
  readonly node: ts.InterfaceDeclaration;
};

/** Every declaration written with the `interface` keyword under `src/`, nested ones included. */
export function findInterfaces(program: ts.Program): InterfaceSite[] {
  const sites: InterfaceSite[] = [];

  for (const path of listSourceFiles(SRC_ROOT)) {
    walk(requireSourceFile(program, path), (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        sites.push({ name: node.name.text, file: toPackagePath(path), node });
      }
    });
  }

  return sites;
}

/** A module's exported names, each resolved through any re-export to the symbol it names. */
export function resolveExports(checker: ts.TypeChecker, sourceFile: ts.SourceFile): Map<string, ts.Symbol> {
  const resolved = new Map<string, ts.Symbol>();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  if (moduleSymbol === undefined) return resolved;

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const isAlias = (exported.flags & ts.SymbolFlags.Alias) !== 0;

    resolved.set(exported.getName(), isAlias ? checker.getAliasedSymbol(exported) : exported);
  }

  return resolved;
}

export type MemberKind = 'method' | 'property';

export type InterfaceShape = {
  readonly members: ReadonlyMap<string, MemberKind>;
  readonly callSignatures: number;
  readonly constructSignatures: number;
  readonly indexSignatures: number;
};

/** The members an interface's type carries, inherited ones included, each as a call or a value. */
export function shapeOf(checker: ts.TypeChecker, node: ts.InterfaceDeclaration): InterfaceShape {
  const symbol = checker.getSymbolAtLocation(node.name);

  if (symbol === undefined) throw new Error(`no symbol for ${node.name.text}`);

  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const members = new Map<string, MemberKind>();

  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.declarations?.[0];
    const isMethod = declaration !== undefined && ts.isMethodSignature(declaration);

    members.set(property.getName(), isMethod ? 'method' : 'property');
  }

  return {
    members,
    callSignatures: checker.getSignaturesOfType(type, ts.SignatureKind.Call).length,
    constructSignatures: checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length,
    indexSignatures: checker.getIndexInfosOfType(type).length,
  };
}
