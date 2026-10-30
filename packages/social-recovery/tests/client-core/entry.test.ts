import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as source from '../../src/index';
import { PACKAGE_ROOT } from '../helpers/source';

const FUNCTIONS = [
  'checkedHeader',
  'pinBlockHeader',
  'configurationBody',
  'configurationCommitment',
  'setupStands',
  'restoreConfiguration',
  'simulationFrom',
  'simulateCall',
  'simulatePrepared',
] as const;

const TYPES = ['PinnedHeader', 'KitRefusalDetails'] as const;

/** The built core entry, which `pnpm build` must have produced before the run. */
const loadBuilt = async (): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(join(PACKAGE_ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;

describe('the client-core surface', () => {
  it.each(FUNCTIONS)('the source entry exports the function %s', (name) => {
    expect(typeof (source as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(FUNCTIONS)('the built entry exports the function %s', async (name) => {
    expect(typeof (await loadBuilt())[name]).toBe('function');
  });

  it('the built entry exports KitRefusalError as a working Error subclass', async () => {
    const Built = (await loadBuilt())['KitRefusalError'] as new (message: string) => Error;
    const error = new Built('refused');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KitRefusalError');
    expect(error.cause).toBeUndefined();
  });

  it('the built entry exports the two constants with their values', async () => {
    const built = await loadBuilt();

    expect(built['CLIENT_CORE_SIMULATION_FROM']).toBe(`0x${'00'.repeat(20)}`);
    expect(built['CLIENT_CORE_NO_SETUP_COMMITMENT']).toBe(`0x${'00'.repeat(32)}`);
  });

  it.each(TYPES)('the built declarations export the type %s', (name) => {
    const declarations = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect(declarations).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('the built declarations declare KitRefusalError with findings and restoreCause', () => {
    const declarations = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect(declarations).toMatch(/class KitRefusalError extends Error/);
    expect(declarations).toMatch(/readonly findings\?: ValidationResult/);
    expect(declarations).toMatch(/readonly restoreCause\?: RestoreCause/);
  });
});
