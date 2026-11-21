import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE, METHOD_ZKPASSPORT_MATERIAL_REJECTED } from '../../src/constants';
import type { Material } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { jsDocOf, PACKAGE_ROOT, SRC_ROOT } from '../helpers/source';
import { IDENTIFIER, PARAMS, stackProof } from './fixtures';

/** A verified enrollment result whose outer proof the installed stack refuses, since it carries no version. */
const BOGUS: Material = { result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('outer_evm_count_4')] } };

const BUILT = join(PACKAGE_ROOT, 'dist', 'recovery-methods.js');

const STACK_FILE = join(SRC_ROOT, 'method-zkpassport', 'stack.ts');

/** Counts and refuses every network attempt in the child: fetch, WebSocket and raw sockets. */
const NO_NETWORK = `
const attempts = [];
const refuse = (what) => () => { attempts.push(what); throw new Error('network: ' + what); };
globalThis.fetch = refuse('fetch');
globalThis.WebSocket = class { constructor() { refuse('websocket')(); } };
process.getBuiltinModule('node:net').Socket.prototype.connect = refuse('socket');
`;

/** Makes the ESM resolution of the peer reject with another code than a directory import, as a missing package does. */
const MISSING_PEER = `
const hooks = "export async function resolve(specifier, context, next) { if (specifier === '@zkpassport/sdk') throw Object.assign(new Error('injected: no peer'), { code: 'ERR_MODULE_NOT_FOUND' }); return next(specifier, context); }";
process.getBuiltinModule('node:module').register('data:text/javascript,' + encodeURIComponent(hooks));
`;

/** Imports the built entry, enrolls through the default stack, and prints the Node version, the answer and the network attempts. */
const ENROLL = `
const { zkPassportMethod } = await import(process.env.STACK_LOAD_ENTRY);
const method = zkPassportMethod();
const result = await method.configFrom(method.enrollInput(JSON.parse(process.env.STACK_LOAD_PARAMS)), JSON.parse(process.env.STACK_LOAD_MATERIAL));
process.stdout.write(JSON.stringify({ node: process.version, result, attempts }));
`;

type ChildAnswer = { readonly node: string; readonly result: unknown; readonly attempts: readonly string[] };

/** Runs one module script under this Node, with only the inputs it needs in its environment. */
function child(script: string): ChildAnswer {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      STACK_LOAD_ENTRY: pathToFileURL(BUILT).href,
      STACK_LOAD_PARAMS: JSON.stringify(PARAMS),
      STACK_LOAD_MATERIAL: JSON.stringify(BOGUS),
    },
  });

  if (run.status !== 0) throw new Error(`child exited ${String(run.status)}: ${run.stderr}`);

  return JSON.parse(run.stdout) as ChildAnswer;
}

/** What the call throws or rejects with, or undefined where it answers. */
async function rejectionOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe('the default stack loads the installed peer in Node', () => {
  it('a child Node importing the built entry enrolls through the peer, which refuses the bogus proof, with no network (needs a build first)', () => {
    const answer = child(`${NO_NETWORK}${ENROLL}`);

    expect(answer.node).toBe(process.version);
    expect(answer.result).toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(answer.attempts).toEqual([]);
  }, 90_000);

  it('the same in this process, from the sources', async () => {
    const method = zkPassportMethod();

    await expect(method.configFrom(method.enrollInput(PARAMS), BOGUS)).resolves.toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  }, 60_000);

  it('the default stack answers a client of the peer with the three members the method calls', async () => {
    const { installedStack } = await import('../../src/method-zkpassport/stack');
    const client = await installedStack(PARAMS.domain);

    expect([typeof client.request, typeof client.getSolidityVerifierParameters, typeof client.cancelRequest]).toEqual(['function', 'function', 'function']);
  }, 60_000);
});

describe('the fallback is taken for a directory import alone', () => {
  afterEach(() => {
    vi.doUnmock('@zkpassport/sdk');
    vi.resetModules();
  });

  it('a child Node whose peer import fails with another code answers device-unavailable: the error is rethrown, not answered from the CommonJS build', () => {
    const answer = child(`${NO_NETWORK}${MISSING_PEER}${ENROLL}`);

    expect(answer.result).toEqual(METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE);
    expect(answer.attempts).toEqual([]);
  }, 90_000);

  it('a double import that rejects with another error rejects the stack with that error', async () => {
    const injected = Object.assign(new Error('injected: the double does not load'), { code: 'ERR_MODULE_NOT_FOUND' });

    vi.resetModules();
    vi.doMock('@zkpassport/sdk', () => {
      throw injected;
    });

    const { installedStack } = await import('../../src/method-zkpassport/stack');
    const rejection = await rejectionOf(() => installedStack(PARAMS.domain));

    // vitest hands the import a wrapper of a throwing mock factory's error, keeping that error as its cause.
    expect(rejection).toBeInstanceOf(Error);
    expect([rejection, (rejection as Error).cause]).toContain(injected);
  });

  it('without process.getBuiltinModule, the directory-import rejection is rethrown as it came', async () => {
    const { installedStack } = await import('../../src/method-zkpassport/stack');
    const saved = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');

    Object.defineProperty(process, 'getBuiltinModule', { value: undefined, configurable: true, writable: true });

    try {
      const rejection = await rejectionOf(() => installedStack(PARAMS.domain));

      expect((rejection as { code?: unknown } | undefined)?.code).toBe('ERR_UNSUPPORTED_DIR_IMPORT');
    } finally {
      if (saved !== undefined) Object.defineProperty(process, 'getBuiltinModule', saved);
    }
  }, 60_000);
});

describe('the Node branch stays out of bundlers\' way', () => {
  it('the built entry imports no node: module, statically or dynamically (needs a build first)', () => {
    const text = readFileSync(BUILT, 'utf8');

    expect(text).not.toMatch(/\bfrom\s*["']node:/);
    expect(text).not.toMatch(/\bimport\(\s*["']node:/);
    expect(text).not.toMatch(/\brequire\(\s*["']node:/);
  });

  it('the default stack\'s documentation says Node loads the CommonJS build, from 22.12', () => {
    const docs = readFileSync(STACK_FILE, 'utf8').match(/\/\*\*[\s\S]*?\*\//g)?.join('\n') ?? '';

    expect(jsDocOf(STACK_FILE, 'installedStack')).toMatch(/CommonJS/);
    expect(docs).toContain('22.12');
  });
});

describe('the Node change\'s changeset', () => {
  const text = (): string => readFileSync(join(PACKAGE_ROOT, '..', '..', '.changeset', 'zkpassport-node-load.md'), 'utf8');

  it('is a patch of the package with a Breaking line naming the narrowed engine, and never names the factory', () => {
    expect(text()).toMatch(/['"]@kohaku-eth\/social-recovery['"]\s*:\s*patch/);
    expect(text()).toMatch(/Breaking/);
    expect(text()).toContain('22.12');
    expect(text()).not.toContain('zkPassportMethod');
  });
});
