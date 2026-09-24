// Reads the value records through the type checker, so the record tests judge
// the types the core entry exports rather than the text that declares them.
import { join } from 'node:path';
import ts from 'typescript';
import { createSourceProgram, requireSourceFile, resolveExports, SRC_ROOT } from './source';

export const RECORDS_ROOT = join(SRC_ROOT, 'interfaces', 'records');

export type RecordContext = {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  /** The core entry's exported names, each resolved to the symbol it names. */
  readonly entry: ReadonlyMap<string, ts.Symbol>;
};

export function loadRecords(): RecordContext {
  const program = createSourceProgram();
  const checker = program.getTypeChecker();
  const entry = resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, 'index.ts')));

  return { program, checker, entry };
}

export function isTypeAlias(symbol: ts.Symbol): boolean {
  return (symbol.flags & ts.SymbolFlags.TypeAlias) !== 0;
}

/** The type a name the core entry exports as a type alias declares. */
export function exportedType(context: RecordContext, name: string): ts.Type {
  const symbol = context.entry.get(name);

  if (symbol === undefined) throw new Error(`src/index.ts does not export ${name}`);

  if (!isTypeAlias(symbol)) throw new Error(`${name} is not a type alias`);

  return context.checker.getDeclaredTypeOfSymbol(symbol);
}

/** The members of a union, or the type itself. */
export function constituents(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

/** The named properties of an object or intersection type, sorted. */
export function propertyNames(checker: ts.TypeChecker, type: ts.Type): string[] {
  return checker
    .getPropertiesOfType(type)
    .map((property) => property.getName())
    .sort();
}

export function propertySymbol(checker: ts.TypeChecker, type: ts.Type, name: string): ts.Symbol {
  const property = checker.getPropertyOfType(type, name);

  if (property === undefined) throw new Error(`no property ${name} on ${checker.typeToString(type)}`);

  return property;
}

/** A property's type with the `undefined` an optional property adds removed. */
export function propertyType(checker: ts.TypeChecker, type: ts.Type, name: string): ts.Type {
  return checker.getNonNullableType(checker.getTypeOfSymbol(propertySymbol(checker, type, name)));
}

export function isOptional(checker: ts.TypeChecker, type: ts.Type, name: string): boolean {
  return (propertySymbol(checker, type, name).flags & ts.SymbolFlags.Optional) !== 0;
}

/** The values of a union of string literals, sorted, or undefined when any member is something else. */
export function stringLiterals(type: ts.Type): string[] | undefined {
  const values: string[] = [];

  for (const member of constituents(type)) {
    if (!member.isStringLiteral()) return undefined;

    values.push(member.value);
  }

  return values.sort();
}

export function hasFlag(type: ts.Type, flag: ts.TypeFlags): boolean {
  return (type.flags & flag) !== 0;
}

/** The union of the string-literal `kind` each constituent of a union carries, sorted. */
export function kindsOf(checker: ts.TypeChecker, type: ts.Type): string[] {
  return constituents(type)
    .flatMap((member) => stringLiterals(propertyType(checker, member, 'kind')) ?? ['<not a literal>'])
    .sort();
}

/** The constituent of a discriminated union whose `kind` is the given literal. */
export function constituentOfKind(checker: ts.TypeChecker, type: ts.Type, kind: string): ts.Type {
  const found = constituents(type).filter((member) => {
    const kinds = stringLiterals(propertyType(checker, member, 'kind'));

    return kinds !== undefined && kinds.length === 1 && kinds[0] === kind;
  });

  if (found.length !== 1) throw new Error(`expected one constituent of kind ${kind}, found ${found.length}`);

  return found[0] as ts.Type;
}

/**
 * Visits a type and everything reachable from it, its union and intersection
 * members, its properties, its index signatures and an array's element, each
 * once, with the path that reached it. An array's own members (`map`,
 * `filter`, ...) are the library's and are not visited.
 */
export function visitType(
  checker: ts.TypeChecker,
  root: ts.Type,
  visit: (type: ts.Type, path: string, via: ts.Symbol | undefined) => void,
  rootPath = '',
): void {
  const seen = new Set<ts.Type>();

  const step = (type: ts.Type, path: string, via: ts.Symbol | undefined): void => {
    visit(type, path, via);

    if (seen.has(type)) return;

    seen.add(type);

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) step(member, path, via);

      return;
    }

    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      for (const element of checker.getTypeArguments(type as ts.TypeReference)) step(element, `${path}[]`, via);

      return;
    }

    if (!hasFlag(type, ts.TypeFlags.Object)) return;

    for (const property of checker.getPropertiesOfType(type)) {
      step(checker.getTypeOfSymbol(property), `${path}.${property.getName()}`, property);
    }

    for (const info of checker.getIndexInfosOfType(type)) step(info.type, `${path}[key]`, undefined);
  };

  step(root, rootPath, undefined);
}

/** A program over one in-memory file, for the detectors' own fixtures. */
export function fixtureProgram(text: string): { checker: ts.TypeChecker; sourceFile: ts.SourceFile } {
  const fileName = '/fixture/fixture.ts';
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  const baseGetSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fileName
      ? ts.createSourceFile(name, text, languageVersion, true)
      : baseGetSourceFile(name, languageVersion, onError, shouldCreate);
  host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
  host.readFile = (name) => (name === fileName ? text : ts.sys.readFile(name));

  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName);

  if (sourceFile === undefined) throw new Error('fixture not in its program');

  return { checker: program.getTypeChecker(), sourceFile };
}

/** The declared type of every type alias a source file declares, by name. */
export function aliasTypes(checker: ts.TypeChecker, sourceFile: ts.SourceFile): Map<string, ts.Type> {
  const types = new Map<string, ts.Type>();

  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;

    const symbol = checker.getSymbolAtLocation(statement.name);

    if (symbol !== undefined) types.set(statement.name.text, checker.getDeclaredTypeOfSymbol(symbol));
  }

  return types;
}
