import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listSourceFiles, SRC_ROOT, toPackagePath } from '../helpers/source';

const IDENTITY_FOLDERS = ['method-aadhaar', 'method-zkpassport'].map((folder) => join(SRC_ROOT, folder));

const METHOD_FOLDERS = ['method-aadhaar', 'method-ecdsa', 'method-passkey', 'method-zkpassport'].map((folder) => join(SRC_ROOT, folder));

const inside = (file: string, folders: readonly string[]): boolean => folders.some((folder) => file.startsWith(`${folder}${sep}`));

/** The source file a relative specifier names; undefined for a bare specifier. */
const resolved = (from: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;

  const base = join(dirname(from), specifier);
  const target = [`${base}.ts`, join(base, 'index.ts'), base].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

  if (target === undefined) throw new Error(`unresolved ${specifier} from ${from}`);

  return target;
};

/** Each `importer -> imported` edge from a file under `importers` to a file under `targets`. */
const edges = (importers: readonly string[], targets: readonly string[]): string[] =>
  importers.flatMap((file) =>
    ts
      .preProcessFile(readFileSync(file, 'utf8'), true, true)
      .importedFiles.map(({ fileName }) => resolved(file, fileName))
      .filter((target): target is string => target !== undefined && inside(target, targets))
      .map((target) => `${toPackagePath(file)} -> ${toPackagePath(target)}`),
  );

describe('the core folders stay blind to the identity methods', () => {
  const files = listSourceFiles(SRC_ROOT);

  it('the walker sees the identity folders from ./recovery-methods, so its silence below means something', () => {
    expect(edges(listSourceFiles(join(SRC_ROOT, 'recovery-methods')), IDENTITY_FOLDERS)).not.toEqual([]);
  });

  it('no file outside the two identity folders and ./recovery-methods imports a file inside them', () => {
    const core = files.filter((file) => !inside(file, [...IDENTITY_FOLDERS, join(SRC_ROOT, 'recovery-methods')]));

    expect(edges(core, IDENTITY_FOLDERS)).toEqual([]);
  });

  it('no validation file imports any method folder: the bounds reach it through the codec on the reads', () => {
    expect(edges(listSourceFiles(join(SRC_ROOT, 'validation')), METHOD_FOLDERS)).toEqual([]);
  });
});
