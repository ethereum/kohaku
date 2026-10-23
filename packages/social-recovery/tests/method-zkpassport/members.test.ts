import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as folder from '../../src/method-zkpassport';
import * as recoveryMethods from '../../src/recovery-methods';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { getAddress } from 'viem';
import * as constants from '../../src/constants';
import * as core from '../../src';
import type { ZkPassportMethodOptions, ZkPassportStack } from '../../src';
import { FORMATS_ZERO_ADDRESS } from '../../src/constants';
import { DEVICE_KINDS } from '../../src/interfaces';
import { createSourceProgram, PACKAGE_ROOT, requireSourceFile, resolveExports, SRC_ROOT } from '../helpers/source';
import { DEFAULT_OUTER, DESCRIPTOR, DIGEST, encodeConfig, makeCtx, PARAMS, stackDouble, stackProof, word } from './fixtures';

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

const CTX = makeCtx(encodeConfig(word(7), PARAMS.domain, PARAMS.scope, 1n));

describe('the ten members', () => {
  const method = zkPassportMethod({ stack: stackDouble().stack });

  it('carries exactly the ten members of IRecoveryMethod and nothing else', () => {
    expect(membersOf(method)).toEqual(TEN);
  });

  it('modules(descriptor) answers the descriptor\'s method-zkpassport address, as a list', () => {
    expect(method.modules(DESCRIPTOR)).toEqual([DESCRIPTOR.methodZkpassport]);

    const other = { ...DESCRIPTOR, methodZkpassport: `0x${'ab'.repeat(20)}` as const };

    expect(method.modules(other)).toEqual([other.methodZkpassport]);
  });

  it('modules(descriptor) answers no module when the deployment carries the zero address for zkPassport', () => {
    expect(method.modules({ ...DESCRIPTOR, methodZkpassport: FORMATS_ZERO_ADDRESS })).toEqual([]);
  });

  it('modules(descriptor) answers a mixed-case (checksummed) address as one module, the same address', () => {
    const mixed = getAddress(`0x${'ab'.repeat(20)}`);

    expect(mixed).not.toBe(mixed.toLowerCase());

    const answered = method.modules({ ...DESCRIPTOR, methodZkpassport: mixed });

    expect(answered).toHaveLength(1);
    expect(answered[0]?.toLowerCase()).toBe(mixed.toLowerCase());
  });

  it('modules(descriptor) answers an address that differs from zero in one nibble as a module', () => {
    const almost = `0x${'0'.repeat(39)}1` as const;

    expect(method.modules({ ...DESCRIPTOR, methodZkpassport: almost })).toEqual([almost]);
  });

  it('deviceBinding is external-app, the named constant', () => {
    expect(method.deviceBinding).toBe('external-app');
    expect(method.deviceBinding).toBe(constants.METHOD_ZKPASSPORT_DEVICE_BINDING);
  });

  it('describe states the device kind, an external proving app, and that the phone shows the name, logo and purpose', () => {
    const double = stackDouble();
    const facts = zkPassportMethod({ stack: double.stack }).describe(CTX);

    expect(facts.kind).toBe('external-proving-app');
    expect(facts.kind).toBe(constants.METHOD_ZKPASSPORT_DEVICE_KIND);
    expect(DEVICE_KINDS).toContain(facts.kind);

    const shown = Object.entries(facts).filter(([key]) => /name/i.test(key) && /logo/i.test(key) && /purpose/i.test(key));

    expect(shown).toEqual([[expect.any(String), true]]);
    expect(double.calls).toEqual([]);
    expect(() => JSON.stringify(facts)).not.toThrow();
    expect(JSON.stringify(facts)).not.toContain(DEFAULT_OUTER.version.slice(2, 18));
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

let program: ts.Program | undefined;

/** One program over `src/`, built once for the two type-level checks. */
const sourceProgram = (): ts.Program => (program ??= createSourceProgram());

/** The method's exported constants, by name. */
const OWN = Object.entries(constants).filter(([name]) => name.startsWith('METHOD_ZKPASSPORT_'));

describe('the method\'s constants', () => {
  it('the material-rejected and device-unavailable failures are frozen typed records', () => {
    expect(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED).toEqual({ kind: 'reply-failure', cause: 'material-rejected' });
    expect(constants.METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE).toEqual({ kind: 'reply-failure', cause: 'device-unavailable' });
    expect(Object.isFrozen(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED)).toBe(true);
    expect(Object.isFrozen(constants.METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE)).toBe(true);
  });

  it('the failures configFrom and replyFrom answer are those frozen records', async () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });
    const absent = zkPassportMethod({ stack: stackDouble({ constructThrows: true }).stack });
    const refused = await method.configFrom(method.enrollInput(PARAMS), undefined);
    const unavailable = await absent.replyFrom(CTX, absent.signingInput(CTX, PARAMS), { proofs: [stackProof('outer_evm_count_5', DIGEST)] });

    expect(refused).toEqual(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(Object.isFrozen(refused)).toBe(true);
    expect(unavailable).toEqual(constants.METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE);
    expect(Object.isFrozen(unavailable)).toBe(true);
  });

  it('the config layout is the pin\'s four flat fields, with no version', () => {
    const layout = constants.METHOD_ZKPASSPORT_CONFIG_LAYOUT as readonly { readonly type: string; readonly name?: string }[];

    expect(layout.map((parameter) => parameter.type)).toEqual(['bytes32', 'string', 'string', 'uint256']);
    expect(JSON.stringify(layout)).not.toMatch(/version/i);
  });

  it('exports no parser regex: the hex patterns are the merged FORMATS_ ones', () => {
    expect(OWN.filter(([, value]) => value instanceof RegExp).map(([name]) => name)).toEqual([]);
    expect(OWN.map(([name]) => name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^METHOD_ZKPASSPORT_(?:WORD|DIGEST|BYTES)_PATTERN$|^METHOD_ZKPASSPORT_UINT256_LIMIT$/)]),
    );
  });
});

describe('the changesets', () => {
  const changesets = join(PACKAGE_ROOT, '..', '..', '.changeset');
  const named = readdirSync(changesets)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, text: readFileSync(join(changesets, name), 'utf8') }))
    .filter(({ text }) => text.includes('zkPassportMethod'));
  const texts = [named.map(({ text }) => text).join('\n')];

  it('the method\'s own changeset and the dev-mode one name the method, each as a patch of the package', () => {
    expect(named.map(({ name }) => name).sort()).toEqual(['identity-test-modes.md', 'social-recovery-method-zkpassport.md']);

    for (const { text } of named) expect(text).toMatch(/['"]@kohaku-eth\/social-recovery['"]\s*:\s*patch/);
  });

  it('the dev-mode changeset states the factory\'s break and names the option', () => {
    const text = named.find(({ name }) => name === 'identity-test-modes.md')?.text ?? '';

    expect(text).toMatch(/Breaking/);
    expect(text).toContain('zkPassportMethod({ stack })');
    expect(text).toContain('devMode');
  });

  it('names the METHOD_ZKPASSPORT_ constants, by prefix or one by one', () => {
    const text = texts[0] ?? '';
    const byPrefix = /METHOD_ZKPASSPORT_(?![A-Z0-9])|METHOD_ZKPASSPORT_\*/.test(text);

    expect(OWN.length).toBeGreaterThan(0);
    expect(byPrefix || OWN.every(([name]) => text.includes(name))).toBe(true);
  });

  it('names every type the method\'s types file exports', () => {
    const program = sourceProgram();
    const typesFile = join(SRC_ROOT, 'types', 'method-zkpassport.ts');
    const names = [...resolveExports(program.getTypeChecker(), requireSourceFile(program, typesFile)).keys()];
    const text = texts[0] ?? '';

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !new RegExp(`\\b${name}\\b`).test(text))).toEqual([]);
  }, 120_000);
});

describe('exports', () => {
  it('the folder\'s index exports the factory alone, at runtime', () => {
    expect(Object.keys(folder)).toEqual(['zkPassportMethod']);
    expect(typeof folder.zkPassportMethod).toBe('function');
  });

  it('the folder\'s index exports the factory and, as a type, its options', () => {
    const program = sourceProgram();
    const exported = resolveExports(program.getTypeChecker(), requireSourceFile(program, join(SRC_ROOT, 'method-zkpassport', 'index.ts')));

    expect([...exported.keys()].sort()).toEqual(['ZkPassportMethodOptions', 'zkPassportMethod']);
  }, 120_000);

  it('the ./recovery-methods entry exports the factory and its options type; the core entry the options type and the dev-mode constants', () => {
    const program = sourceProgram();
    const checker = program.getTypeChecker();
    const second = [...resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, 'recovery-methods', 'index.ts'))).keys()];
    const first = [...resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, 'index.ts'))).keys()];

    expect(second).toEqual(expect.arrayContaining(['zkPassportMethod', 'ZkPassportMethodOptions']));
    expect(first).toEqual(
      expect.arrayContaining([
        'ZkPassportMethodOptions',
        'METHOD_ZKPASSPORT_DEFAULT_DEV_MODE',
        'METHOD_ZKPASSPORT_MOCK_NON_SALTED_NULLIFIER',
        'METHOD_ZKPASSPORT_DEV_MODE_NULLIFIER_TYPES',
      ]),
    );
    expect(first).not.toContain('METHOD_ZKPASSPORT_DEV_MODE');
    expect(first).not.toContain('zkPassportMethod');
  }, 120_000);

  it('the options record takes an optional stack and an optional boolean devMode, and the factory takes the record', () => {
    expectTypeOf<ZkPassportMethodOptions['stack']>().toEqualTypeOf<ZkPassportStack | undefined>();
    expectTypeOf<ZkPassportMethodOptions['devMode']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Parameters<typeof zkPassportMethod>>().toEqualTypeOf<[options?: ZkPassportMethodOptions]>();
  });

  it('the dev-mode constants hold their values at runtime on the core entry, and the old name is gone', () => {
    expect(core.METHOD_ZKPASSPORT_DEFAULT_DEV_MODE).toBe(false);
    expect(core.METHOD_ZKPASSPORT_MOCK_NON_SALTED_NULLIFIER).toBe(2n);
    expect([...core.METHOD_ZKPASSPORT_DEV_MODE_NULLIFIER_TYPES]).toEqual([0n, 2n]);
    expect(core.METHOD_ZKPASSPORT_NON_SALTED_NULLIFIER).toBe(0n);
    expect(Object.keys(core)).not.toContain('METHOD_ZKPASSPORT_DEV_MODE');
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
