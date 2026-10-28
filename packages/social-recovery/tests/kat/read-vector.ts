import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vectors');

/** One vector row: the input fields and what the derivation must produce for them. */
export type VectorRow = {
  readonly 'id'?: string;
  readonly name?: string;
  readonly input: Record<string, unknown>;
  readonly expected: unknown;
  readonly [key: string]: unknown;
};

/** One parsed vector file. */
export type VectorFile = {
  readonly format: string;
  readonly derivation?: string;
  readonly vectors: readonly VectorRow[];
  readonly [key: string]: unknown;
};

/**
 * Reads one copied vector file by name, e.g. `readVector('setup-body.json')`.
 * A missing or malformed copy throws, so a replay can never pass by skipping.
 */
export function readVector(fileName: string): VectorFile {
  const text = readFileSync(join(VECTORS_DIR, fileName), 'utf8');
  const parsed: unknown = JSON.parse(text);

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as VectorFile).vectors)) {
    throw new Error(`vector file ${fileName} has no vectors array`);
  }

  return parsed as VectorFile;
}
