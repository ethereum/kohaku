import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vectors');
const PROVENANCE_PATH = join(VECTORS_DIR, 'PROVENANCE.md');
/** The commit of defi-wonderland/mast-social-recovery-2 the vectors are byte-for-byte copies from. */
const SOURCE_COMMIT = '2a12948d47881f43bbe32f3c4b3b82dbdc89efdd';
const EXPECTED_FILE_COUNT = 22;

type ListedFile = { readonly name: string; readonly sha256: string };

const ROW = /^\|\s*`([^`]+\.json)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/;

const parseTable = (markdown: string): ListedFile[] => {
  const rows: ListedFile[] = [];

  for (const line of markdown.split('\n')) {
    const match = ROW.exec(line);

    if (match !== null) {
      const [, name, sha256] = match;

      if (name !== undefined && sha256 !== undefined) rows.push({ name, sha256 });
    }
  }

  return rows;
};

const sha256Of = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const provenance = readFileSync(PROVENANCE_PATH, 'utf8');
const listed = parseTable(provenance);

describe('blessed vector copies (PROVENANCE.md)', () => {
  it('names the source repository and commit', () => {
    expect(provenance).toContain('defi-wonderland/mast-social-recovery-2');
    expect(provenance).toContain(SOURCE_COMMIT);
  });

  it('lists every copied file exactly once', () => {
    // Guard against a vacuous pass from an empty or mis-parsed table.
    expect(listed).toHaveLength(EXPECTED_FILE_COUNT);
    expect(new Set(listed.map((row) => row.name)).size).toBe(listed.length);
  });

  it('holds no unlisted .json file', () => {
    const onDisk = readdirSync(VECTORS_DIR).filter((name) => name.endsWith('.json')).sort();

    expect(onDisk).toEqual(listed.map((row) => row.name).sort());
  });

  it.each(listed)('$name exists with the listed sha256', ({ name, sha256 }) => {
    const path = join(VECTORS_DIR, name);

    expect(existsSync(path)).toBe(true);
    expect(sha256Of(path)).toBe(sha256);
  });

  it('every file parses as JSON; shape outliers are reported, not failed', () => {
    const outliers: string[] = [];

    for (const { name } of listed) {
      const parsed: unknown = JSON.parse(readFileSync(join(VECTORS_DIR, name), 'utf8'));
      const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;

      if (record === undefined) {
        outliers.push(`${name}: top level is not an object`);
        continue;
      }

      if (typeof record['format'] !== 'string') outliers.push(`${name}: no string "format"`);

      if (!Array.isArray(record['vectors']) || record['vectors'].length === 0) {
        outliers.push(`${name}: no non-empty "vectors" array`);
      }
    }

    if (outliers.length > 0) console.warn(`vector files with a different shape:\n${outliers.join('\n')}`);

    expect(listed.length).toBeGreaterThan(0);
  });
});
