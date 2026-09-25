import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as folder from '../../src/method-zkpassport';
import * as recoveryMethods from '../../src/recovery-methods';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { DEVICE_KINDS } from '../../src/interfaces';
import { createSourceProgram, PACKAGE_ROOT, requireSourceFile, resolveExports, SRC_ROOT } from '../helpers/source';
import { DESCRIPTOR, encodeConfig, makeCtx, PARAMS, stackDouble, word } from './fixtures';

const TEN = [
  'codec',
  'configFrom',
  'describe',
  'deviceBinding',
  'enrollInput',
  'modules',
  'replyFrom',
  'signingInput',
  'vector',
  'verify',
];

/** Every name an object answers to, own or inherited, short of Object.prototype. */
function membersOf(value: object): string[] {
  const names = new Set<string>();

  for (let at: object | null = value; at !== null && at !== Object.prototype; at = Object.getPrototypeOf(at) as object | null) {
    for (const name of Object.getOwnPropertyNames(at)) if (name !== 'constructor') names.add(name);
  }

  return [...names].sort();
}

const CTX = makeCtx(encodeConfig(word(7), word(1), PARAMS.domain, PARAMS.scope, 1n));

describe('the ten members', () => {
  const method = zkPassportMethod(stackDouble().stack);

  it('carries exactly the ten members of IRecoveryMethod and nothing else', () => {
    expect(membersOf(method)).toEqual(TEN);
  });

  it('modules(descriptor) answers the descriptor\'s method-zkpassport address, as a list', () => {
    expect(method.modules(DESCRIPTOR)).toEqual([DESCRIPTOR.methodZkpassport]);

    const other = { ...DESCRIPTOR, methodZkpassport: `0x${'ab'.repeat(20)}` as const };

    expect(method.modules(other)).toEqual([other.methodZkpassport]);
  });

  it('deviceBinding is external-app', () => {
    expect(method.deviceBinding).toBe('external-app');
  });

  it('describe states the device kind, an external proving app, and that the phone shows the name, logo and purpose', () => {
    const double = stackDouble();
    const facts = zkPassportMethod(double.stack).describe(CTX);

    expect(facts.kind).toBe('external-proving-app');
    expect(DEVICE_KINDS).toContain(facts.kind);

    const shown = Object.entries(facts).filter(([key]) => /name/i.test(key) && /logo/i.test(key) && /purpose/i.test(key));

    expect(shown).toEqual([[expect.any(String), true]]);
    expect(double.calls).toEqual([]);
    expect(() => JSON.stringify(facts)).not.toThrow();
  });

  it('describe states the stack\'s standing, naming the pinned stack', () => {
    expect(JSON.stringify(method.describe(CTX))).toContain('@zkpassport/sdk');
    expect(JSON.stringify(method.describe(CTX))).toContain('0.17.1');
  });

  it('vector names the two blessed files', () => {
    expect([...method.vector]).toEqual(['method-zkpassport-config.json', 'method-zkpassport-proof.json']);
  });

  it('codec carries the four pure functions of IMethodCodec', () => {
    expect(membersOf(method.codec)).toEqual(['decodeConfig', 'decodeProof', 'encodeConfig', 'encodeProof']);
  });

  it('the default factory constructs and enrolls without loading the stack', () => {
    const input = zkPassportMethod().enrollInput(PARAMS);

    expect(input.kind).toBe('ceremony');
  });
});

describe('exports', () => {
  it('the folder\'s index exports the factory alone, at runtime', () => {
    expect(Object.keys(folder)).toEqual(['zkPassportMethod']);
    expect(typeof folder.zkPassportMethod).toBe('function');
  });

  it('the folder\'s index exports the factory alone, types included', () => {
    const program = createSourceProgram();
    const exported = resolveExports(program.getTypeChecker(), requireSourceFile(program, join(SRC_ROOT, 'method-zkpassport', 'index.ts')));

    expect([...exported.keys()]).toEqual(['zkPassportMethod']);
  });

  it('the ./recovery-methods entry exports the same factory', () => {
    expect(recoveryMethods.zkPassportMethod).toBe(zkPassportMethod);
  });
});

/** The files and bare specifiers reachable from one entry, static and dynamic imports and re-exports alike. */
function moduleGraph(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop() as string;

    if (files.has(file)) continue;

    files.add(file);

    const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);

    for (const { fileName } of info.importedFiles) {
      if (!fileName.startsWith('.')) {
        bare.add(fileName);
        continue;
      }

      const base = join(dirname(file), fileName);
      const target = [`${base}.ts`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));

      if (target === undefined) throw new Error(`unresolved ${fileName} from ${file}`);

      pending.push(target);
    }
  }

  return { files, bare };
}

describe('the core entry never pulls the stack', () => {
  it('the walker sees the stack from the ./recovery-methods entry (so its silence below means something)', () => {
    const graph = moduleGraph(join(SRC_ROOT, 'recovery-methods', 'index.ts'));

    expect(graph.bare.has('@zkpassport/sdk')).toBe(true);
  });

  it('no file of src/method-zkpassport and no @zkpassport specifier is reachable from src/index.ts', () => {
    const graph = moduleGraph(join(SRC_ROOT, 'index.ts'));

    expect([...graph.files].filter((file) => file.includes(`${join('src', 'method-zkpassport')}`))).toEqual([]);
    expect([...graph.bare].filter((specifier) => specifier.startsWith('@zkpassport'))).toEqual([]);
  });

  it('the stack is loaded by dynamic import alone, so importing the entry does not load it', () => {
    const texts = [...moduleGraph(join(SRC_ROOT, 'recovery-methods', 'index.ts')).files].map((file) => readFileSync(file, 'utf8'));
    const staticImport = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*['"]@zkpassport\//;

    expect(texts.some((text) => staticImport.test(text.replace(/import\s+type\b[^;]*;/g, '')))).toBe(false);
    expect(texts.some((text) => /import\(\s*['"]@zkpassport\/sdk['"]\s*\)/.test(text))).toBe(true);
  });

  const built = join(PACKAGE_ROOT, 'dist', 'index.js');

  it('the built core entry names no @zkpassport module (needs a build first)', () => {
    expect(readFileSync(built, 'utf8')).not.toContain('@zkpassport');
  });
});
