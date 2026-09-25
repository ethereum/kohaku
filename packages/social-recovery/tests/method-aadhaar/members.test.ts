import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { DeploymentDescriptor, IRecoveryMethod } from '../../src/interfaces';
import { DEVICE_BINDINGS } from '../../src/interfaces';
import * as folder from '../../src/method-aadhaar';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import * as recoveryMethods from '../../src/recovery-methods';
import { PACKAGE_ROOT, SRC_ROOT, createSourceProgram, requireSourceFile, resolveExports } from '../helpers/source';
import { configBytes, ctxFor, stackDouble } from './fixtures';

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
] as const;

const method: IRecoveryMethod = anonAadhaarMethod({ stack: stackDouble().stack });

const addr = (byte: string): `0x${string}` => `0x${byte.repeat(20)}`;

const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: addr('01'),
  methodEcdsa: addr('02'),
  methodPasskey: addr('03'),
  methodAadhaar: addr('04'),
  methodZkpassport: addr('05'),
  action: addr('06'),
  servedImplementation: addr('07'),
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [addr('02'), addr('03'), addr('04'), addr('05')],
  auditedActions: [addr('06')],
};

describe('the ten members', () => {
  it('carries each of the ten, calls as functions and values as values', () => {
    for (const name of TEN) expect(name in method, name).toBe(true);

    const calls = TEN.filter((name) => typeof method[name] === 'function');

    expect(calls.sort()).toEqual(['configFrom', 'describe', 'enrollInput', 'modules', 'replyFrom', 'signingInput', 'verify']);
  });

  it('exposes no public member beyond the ten, per the type the factory returns', () => {
    const program = createSourceProgram();
    const checker = program.getTypeChecker();
    const entry = resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, 'method-aadhaar', 'index.ts')));
    const factory = entry.get('anonAadhaarMethod');
    const declaration = factory?.valueDeclaration;

    expect(declaration).toBeDefined();

    if (declaration === undefined || factory === undefined) return;

    const signature = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(factory, declaration), ts.SignatureKind.Call)[0];
    const returned = signature === undefined ? undefined : checker.getReturnTypeOfSignature(signature);
    const names = returned === undefined ? [] : checker.getPropertiesOfType(returned).map((property) => property.getName());

    expect(names.sort()).toEqual([...TEN]);
  });

  it('the codec carries exactly the four functions of IMethodCodec', () => {
    expect(Object.keys(method.codec).sort()).toEqual(['decodeConfig', 'decodeProof', 'encodeConfig', 'encodeProof']);
  });

  it('modules(descriptor) is the descriptor own methodAadhaar address and nothing else', () => {
    expect(method.modules(DESCRIPTOR)).toEqual([addr('04')]);
    expect(method.modules({ ...DESCRIPTOR, methodAadhaar: addr('aa') })).toEqual([addr('aa')]);
  });

  it('deviceBinding is in-browser-prover, a member of DEVICE_BINDINGS', () => {
    expect(method.deviceBinding).toBe('in-browser-prover');
    expect(DEVICE_BINDINGS).toContain(method.deviceBinding);
  });

  it('describe states an in-page prover, that the QR image stays on the device and that proving takes tens of seconds', () => {
    const facts = method.describe(ctxFor(configBytes(1n, 2n), `0x${'00'.repeat(32)}`));
    const entries = Object.entries(facts);

    expect(facts.kind).toBe('in-page-prover');
    expect(entries.some(([key, value]) => /qr/i.test(key) && value === false)).toBe(true);
    expect(entries.some(([, value]) => typeof value === 'string' && /tens.of.seconds/i.test(value))).toBe(true);
    expect(entries.some(([, value]) => typeof value === 'string' && /in.browser/i.test(value))).toBe(true);
    expect(entries.every(([, value]) => typeof value !== 'function')).toBe(true);
  });

  it('vector names the two blessed files', () => {
    expect([...method.vector].sort()).toEqual(['method-aadhaar-config.json', 'method-aadhaar-proof.json']);
  });

  it('touches no stack while answering the pure members', () => {
    const double = stackDouble();
    const pure = anonAadhaarMethod({ stack: double.stack });

    pure.modules(DESCRIPTOR);
    pure.describe(ctxFor(configBytes(1n, 2n), `0x${'00'.repeat(32)}`));
    pure.enrollInput({ nullifierSeed: 1n, issuerCertificate: 'pem' });

    expect(double.total()).toBe(0);
  });
});

describe('the package surface', () => {
  it('the factory refuses a stack and artifacts together, and malformed artifacts, before any import', () => {
    const artifacts = { wasmURL: 'w', zkeyURL: 'z', vkeyURL: 'v', artifactsOrigin: 'server' } as const;

    expect(() => anonAadhaarMethod({ stack: stackDouble().stack, artifacts })).toThrow(TypeError);
    expect(() => anonAadhaarMethod({ artifacts: { ...artifacts, wasmURL: '' } })).toThrow(TypeError);
    expect(() => anonAadhaarMethod({ artifacts: { ...artifacts, artifactsOrigin: 'ftp' as never } })).toThrow(TypeError);
  });

  it('the folder index exports the factory alone, as a value and as a type', () => {
    expect(Object.keys(folder)).toEqual(['anonAadhaarMethod']);

    const program = createSourceProgram();
    const entry = resolveExports(program.getTypeChecker(), requireSourceFile(program, join(SRC_ROOT, 'method-aadhaar', 'index.ts')));

    expect([...entry.keys()]).toEqual(['anonAadhaarMethod']);
  });

  it('the ./recovery-methods entry exports the same factory', () => {
    expect(recoveryMethods.anonAadhaarMethod).toBe(anonAadhaarMethod);
  });

  it('the core entry src/index.ts reaches neither the method folder nor the stack', () => {
    const seen = new Set<string>();
    const bare: string[] = [];
    const queue = [join(SRC_ROOT, 'index.ts')];

    while (queue.length > 0) {
      const file = queue.pop() ?? '';

      if (seen.has(file)) continue;

      seen.add(file);

      for (const imported of ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles) {
        if (!imported.fileName.startsWith('.')) {
          bare.push(imported.fileName);
          continue;
        }

        const base = resolve(dirname(file), imported.fileName);
        const target = [`${base}.ts`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));

        if (target !== undefined) queue.push(target);
      }
    }

    expect([...seen].some((file) => file.includes(`${join('src', 'method-aadhaar')}`))).toBe(false);
    expect([...seen].some((file) => file.includes(`${join('src', 'recovery-methods')}`))).toBe(false);
    expect(bare.filter((name) => name.startsWith('@anon-aadhaar'))).toEqual([]);
  });
});

const DIST = join(PACKAGE_ROOT, 'dist');
const TEST_KEY = '15134874015316324267425466444584014077184337590635665158241104437045239495873';

describe('the built output (needs a build first)', () => {
  const read = (name: string): string => readFileSync(join(DIST, name), 'utf8');

  it.each(['snarkjs', 'node-forge', TEST_KEY])('no built script contains %s', (needle) => {
    const scripts = readdirSync(DIST).filter((name) => name.endsWith('.js'));

    expect(scripts).toContain('recovery-methods.js');

    for (const name of scripts) expect(read(name).includes(needle), name).toBe(false);
  });

  it('recovery-methods.js keeps @anon-aadhaar/core external and the core entry never names it', () => {
    expect(read('recovery-methods.js')).toMatch(/import\(\s*["']@anon-aadhaar\/core["']\s*\)/);
    expect(read('index.js').includes('anon-aadhaar')).toBe(false);
  });
});
