import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as source from '../../src/index';
import { SocialRecoveryBuilder } from '../../src/index';
import { PACKAGE_ROOT } from '../helpers/source';
import { builderMessages, holder } from './doubles';

const loadBuilt = async (): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(join(PACKAGE_ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;

const VALUES = [
  'SocialRecoveryBuilder',
  'descriptorOriginOf',
  'BUILDER_DEFAULT_DESCRIPTORS',
  'BUILDER_SEPOLIA_DESCRIPTOR',
  'BUILDER_MAINNET_DESCRIPTOR',
  'BUILDER_DEFAULT_CONFIGURATION',
  'BUILDER_DEFAULT_LOG_CHUNK_SIZE',
  'BUILDER_DEFAULT_WAIT',
  'BUILDER_SHORT_WAIT',
  'BUILDER_MAX_WAIT',
  'BUILDER_REQUEST_WINDOW',
  'BUILDER_CANCEL_WINDOW',
  'BUILDER_RULE_COST_BOUND',
  'BUILDER_BLOCK_TAGS',
  'BUILDER_DOMAIN_FIELDS',
  'BUILDER_HOLDER_INPUT_MEMBERS',
  'BUILDER_APPROVER_INPUT_MEMBERS',
] as const;

const INPUT_MEMBERS = [
  ['BUILDER_HOLDER_INPUT_MEMBERS', ['provider', 'account', 'chainId', 'descriptor', 'configuration', 'deviceBindings']],
  ['BUILDER_APPROVER_INPUT_MEMBERS', ['chainId', 'descriptor', 'deviceBindings']],
] as const;

describe('the builder surface', () => {
  it.each(VALUES)('exports %s from the source and the built core entry', async (name) => {
    expect((source as Record<string, unknown>)[name]).toBeDefined();
    expect((await loadBuilt())[name]).toBeDefined();
  });

  it('exports the refusal messages as non-empty strings, each its own', () => {
    const messages = builderMessages();

    expect(messages.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);

    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });

  it('keeps its state out of reach', () => {
    const builder = SocialRecoveryBuilder.from(holder());

    expect(Object.keys(builder)).toEqual([]);
    expect(JSON.stringify(builder)).toBe('{}');
  });

  it.each(INPUT_MEMBERS)('exports %s frozen, naming exactly the members of its shape, from the source and the built entry', async (name, members) => {
    const built = (await loadBuilt())[name];
    const declaration = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    for (const list of [(source as Record<string, unknown>)[name], built]) {
      expect(Array.isArray(list)).toBe(true);
      expect(Object.isFrozen(list)).toBe(true);
      expect([...(list as readonly string[])].sort()).toEqual([...members].sort());
    }

    expect(declaration).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('keeps checkedDescriptorOrigin out of the source entry, the built entry and the built declaration', async () => {
    const declaration = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect('checkedDescriptorOrigin' in source).toBe(false);
    expect('checkedDescriptorOrigin' in (await loadBuilt())).toBe(false);
    expect(declaration).not.toMatch(/\bcheckedDescriptorOrigin\b/);
  });

  it.each(['answersOf', 'ManagerAnswers'])('no longer exports %s from the source entry, the built entry or the built declaration', async (name) => {
    const declaration = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect(name in source).toBe(false);
    expect(name in (await loadBuilt())).toBe(false);
    expect(declaration).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});
