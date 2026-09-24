import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasModifier, INTERFACES_ROOT, listSourceFiles, parseSource, walk } from '../helpers/source';

// The brief's open records question, proposal adopted by the implementer:
// src/interfaces/records.ts declares each record name the members reference as
// `export type Name = Placeholder<'Name'>` over one `Placeholder<Name>` brand,
// under a header naming PT-071 as the task that replaces the file, and no
// member's signature invents a field.

const RECORDS_PATH = join(INTERFACES_ROOT, 'records.ts');
const BRAND = 'Placeholder';

const records = parseSource(RECORDS_PATH);
const aliases = records.statements.filter(ts.isTypeAliasDeclaration);
const recordAliases = aliases.filter((alias) => alias.name.text !== BRAND);

/** The name a `Placeholder<'Name', ...>` reference carries, or undefined for any other type. */
function brandedName(type: ts.TypeNode): string | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeName.text !== BRAND) {
    return undefined;
  }

  const [first] = type.typeArguments ?? [];

  if (first === undefined || !ts.isLiteralTypeNode(first) || !ts.isStringLiteral(first.literal)) return undefined;

  return first.literal.text;
}

describe('src/interfaces/records.ts', () => {
  it('opens with a header marking the file as placeholders PT-071 replaces', () => {
    const header = records.getFullText().slice(0, records.statements[0]?.getStart(records) ?? 0);

    expect(header).toMatch(/PLACEHOLDER/i);
    expect(header).toContain('PT-071');
  });

  it('declares the one brand, Placeholder, exported and generic over the record name', () => {
    const brands = aliases.filter((alias) => alias.name.text === BRAND);

    expect(brands).toHaveLength(1);

    const [brand] = brands;

    expect(brand !== undefined && hasModifier(brand, ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(brand?.typeParameters?.[0]?.name.text).toBe('Name');
    expect(brand?.typeParameters?.[0]?.constraint?.kind).toBe(ts.SyntaxKind.StringKeyword);
  });

  it('declares records to judge', () => {
    expect(recordAliases.length).toBeGreaterThan(0);
  });

  it('declares every record as the Placeholder brand over its own name', () => {
    const offBrand = recordAliases
      .filter((alias) => brandedName(alias.type) !== alias.name.text)
      .map((alias) => `${alias.name.text} = ${alias.type.getText(records)}`);

    expect(offBrand).toEqual([]);
  });

  it('exports every record it declares', () => {
    const unexported = recordAliases
      .filter((alias) => !hasModifier(alias, ts.SyntaxKind.ExportKeyword))
      .map((alias) => alias.name.text);

    expect(unexported).toEqual([]);
  });

  it('declares no interface, class, enum, function or exported value', () => {
    const others = records.statements
      .filter((statement) => {
        if (ts.isTypeAliasDeclaration(statement)) return false;

        // The brand's key: one ambient, unexported `declare const ...: unique symbol`.
        const isBrandKey =
          ts.isVariableStatement(statement) &&
          hasModifier(statement, ts.SyntaxKind.DeclareKeyword) &&
          !hasModifier(statement, ts.SyntaxKind.ExportKeyword);

        return !isBrandKey;
      })
      .map((statement) => ts.SyntaxKind[statement.kind]);

    expect(others).toEqual([]);
  });

  it('nests no interface anywhere in the file', () => {
    const nested: string[] = [];

    walk(records, (node) => {
      if (ts.isInterfaceDeclaration(node)) nested.push(node.name.text);
    });

    expect(nested).toEqual([]);
  });
});

describe('the interfaces over the placeholders', () => {
  const interfaceFiles = listSourceFiles(INTERFACES_ROOT).filter((path) => path !== RECORDS_PATH);

  it('invent no field: no member signature writes an object type of its own', () => {
    const inventions: string[] = [];

    for (const path of interfaceFiles) {
      const sourceFile = parseSource(path);

      walk(sourceFile, (node) => {
        if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

          inventions.push(`${path}:${line + 1} ${node.getText(sourceFile)}`);
        }
      });
    }

    expect(inventions).toEqual([]);
  });

  it('declare no type of their own beside the twelve interfaces, leaving every record to records.ts', () => {
    const declared: string[] = [];

    for (const path of interfaceFiles) {
      for (const statement of parseSource(path).statements) {
        if (ts.isTypeAliasDeclaration(statement)) declared.push(`${path}: type ${statement.name.text}`);
      }
    }

    expect(declared).toEqual([]);
  });
});
