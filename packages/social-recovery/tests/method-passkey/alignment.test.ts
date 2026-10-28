import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import * as core from '../../src';
import type { EnrollInput, Hex, Input } from '../../src/interfaces';
import {
  createSourceProgram,
  listSourceFiles,
  parseSource,
  REPO_ROOT,
  requireSourceFile,
  resolveExports,
  SRC_ROOT,
  toPackagePath,
  walk,
} from '../helpers/source';
import { configOfKey, creation, ctxFor, freshKey, HALF_N, hexOf, N, proofBytes, sha256 } from './fixtures';

const method = core.passkeyMethod();
const { codec } = method;
const REFUSED = { kind: 'reply-failure', cause: 'material-rejected' };

const METHOD_DIR = join(SRC_ROOT, 'method-passkey');
const methodFiles = listSourceFiles(METHOD_DIR);

/** The error a call throws, or undefined where it returns. */
const thrown = (call: () => unknown): unknown => {
  try {
    call();
  } catch (error) {
    return error;
  }

  return undefined;
};

/** A TypeError or a RangeError, never a plain Error or another class. */
const isArgumentError = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError;

const x = 0x1234n;
const y = N - 1n;
const rpIdHash = hexOf(sha256('wallet.example'));
const authenticatorData = `0x${'11'.repeat(32)}0500000001` as Hex;
const clientDataJSON = '{"type":"webauthn.get","challenge":"AA"}';
const proof = { authenticatorData, clientDataJSON, r: 5n, s: 7n };

/** A sparse array with a hole at index 0 and one value after it. */
const sparse = (value: unknown): unknown[] => {
  const array: unknown[] = [];

  array[1] = value;

  return array;
};

describe('the codec: a shape fault is a TypeError, a width or range fault a RangeError', () => {
  it.each([
    ['x as a string', { x: '1', y, rpIdHash }],
    ['x as a number', { x: 1, y, rpIdHash }],
    ['rpIdHash too short', { x, y, rpIdHash: '0x1234' }],
    ['rpIdHash not hex', { x, y, rpIdHash: `0x${'zz'.repeat(32)}` }],
    ['rpIdHash a number', { x, y, rpIdHash: 42 }],
    ['rpIdHash missing', { x, y }],
    ['an extra field', { x, y, rpIdHash, rpId: 'wallet.example' }],
  ])('encodeConfig refuses %s with a TypeError', (_label, fields) => {
    expect(() => codec.encodeConfig(fields as never)).toThrow(TypeError);
  });

  it.each([
    ['x at 2^256', { x: 1n << 256n, y, rpIdHash }],
    ['y at 2^256', { x, y: 1n << 256n, rpIdHash }],
    ['x below zero', { x: -1n, y, rpIdHash }],
  ])('encodeConfig refuses %s with a RangeError', (_label, fields) => {
    expect(() => codec.encodeConfig(fields)).toThrow(RangeError);
  });

  it.each([
    ['odd-length authenticator data', { ...proof, authenticatorData: '0x123' }],
    ['authenticator data that is not a string', { ...proof, authenticatorData: 7 }],
    ['client data that is not text', { ...proof, clientDataJSON: 5 }],
    ['r as a string', { ...proof, r: '5' }],
    ['s as a number', { ...proof, s: 7 }],
    ['s missing', { authenticatorData, clientDataJSON, r: 5n }],
    ['an extra field', { ...proof, v: 1n }],
  ])('encodeProof refuses %s with a TypeError', (_label, fields) => {
    expect(() => codec.encodeProof(fields as never)).toThrow(TypeError);
  });

  it.each([
    ['r at 2^256', { ...proof, r: 1n << 256n }],
    ['r below zero', { ...proof, r: -1n }],
    ['s above n/2', { ...proof, s: HALF_N + 1n }],
    ['s at 2^256', { ...proof, s: 1n << 256n }],
  ])('encodeProof refuses %s with a RangeError', (_label, fields) => {
    expect(() => codec.encodeProof(fields)).toThrow(RangeError);
  });

  it('decodeProof refuses a proof carrying a high s with a RangeError', () => {
    expect(() => codec.decodeProof(proofBytes(authenticatorData, clientDataJSON, 5n, N - 7n))).toThrow(RangeError);
  });

  it.each([
    ['not hex', `0x${'zz'.repeat(96)}`],
    ['a number', 42],
    ['no 0x prefix', configOfKey(freshKey(), 'wallet.example').slice(2)],
  ])('decodeConfig refuses %s with a TypeError', (_label, bytes) => {
    expect(() => codec.decodeConfig(bytes as Hex)).toThrow(TypeError);
  });

  it.each([
    ['empty', '0x'],
    ['one byte short', configOfKey(freshKey(), 'wallet.example').slice(0, -2)],
    ['one byte long', `${configOfKey(freshKey(), 'wallet.example')}00`],
  ])('decodeConfig refuses %s with a TypeError or a RangeError, never a plain Error', (_label, bytes) => {
    const error = thrown(() => codec.decodeConfig(bytes as Hex));

    expect(error).toBeDefined();
    expect(isArgumentError(error)).toBe(true);
  });

  it('decodeProof refuses malformed bytes with a TypeError or a RangeError, never a plain Error', () => {
    const encoded = proofBytes(authenticatorData, clientDataJSON, 5n, 7n);
    const handBuiltNotUtf8 = `0x${[
      (0x80).toString(16).padStart(64, '0'),
      (0x80 + 32 + 64).toString(16).padStart(64, '0'),
      (5).toString(16).padStart(64, '0'),
      (7).toString(16).padStart(64, '0'),
      (37).toString(16).padStart(64, '0'),
      `${'11'.repeat(32)}0500000001`.padEnd(128, '0'),
      (1).toString(16).padStart(64, '0'),
      'ff'.padEnd(64, '0'),
    ].join('')}`;

    for (const bytes of ['0x', `0x${'zz'}`, `${encoded}00`, encoded.slice(0, -64), `0x${encoded.slice(2, 64)}a0${encoded.slice(66)}`, handBuiltNotUtf8]) {
      const error = thrown(() => codec.decodeProof(bytes as Hex));

      expect(error).toBeDefined();
      expect(isArgumentError(error)).toBe(true);
    }
  });
});

describe('holes and arrays where the method expects an object or bytes', () => {
  const ctx = ctxFor(configOfKey(freshKey(), 'wallet.example'));

  it('enrollInput and signingInput refuse a sparse array as their parameters with a TypeError naming the parameter', () => {
    expect(() => method.enrollInput(sparse('wallet.example') as never)).toThrow(/relyingPartyId/);
    expect(() => method.enrollInput(sparse('wallet.example') as never)).toThrow(TypeError);
    expect(() => method.signingInput(ctx, sparse('wallet.example') as never)).toThrow(TypeError);
    expect(() => method.signingInput(ctx, sparse('wallet.example') as never)).toThrow(/relyingPartyId/);
  });

  it('a parameter given as a sparse array is a TypeError naming it', () => {
    expect(() => method.enrollInput({ relyingPartyId: sparse('a'), userName: 'alice' })).toThrow(/relyingPartyId/);
    expect(() => method.enrollInput({ relyingPartyId: 'wallet.example', userName: sparse('a') })).toThrow(/userName/);
    expect(() => method.signingInput(ctx, { relyingPartyId: 'wallet.example', credentialId: sparse('a') })).toThrow(TypeError);
    expect(() => method.signingInput(ctx, { relyingPartyId: 'wallet.example', credentialId: sparse('a') })).toThrow(/credentialId/);
  });

  it('the codec refuses a sparse array as its fields, or as a field, with a TypeError', () => {
    expect(() => codec.encodeConfig(sparse(x) as never)).toThrow(TypeError);
    expect(() => codec.encodeConfig({ x: sparse(x), y, rpIdHash } as never)).toThrow(TypeError);
    expect(() => codec.encodeProof({ ...proof, authenticatorData: sparse(1) } as never)).toThrow(TypeError);
    expect(() => codec.encodeProof({ ...proof, clientDataJSON: sparse('{') } as never)).toThrow(TypeError);
  });

  it('material holding sparse arrays where the browser hands buffers is a typed failure, never a throw', async () => {
    const input = method.enrollInput({ relyingPartyId: 'wallet.example', userName: 'alice' });
    const signing = method.signingInput(ctx, { relyingPartyId: 'wallet.example' });
    const holes = new Array<number>(64);

    expect(await method.configFrom(input, sparse(1) as never)).toEqual(REFUSED);
    expect(await method.configFrom(input, { credential: { response: { attestationObject: holes } } })).toEqual(REFUSED);
    expect(await method.replyFrom(ctx, signing, sparse(1) as never)).toEqual(REFUSED);
    expect(
      await method.replyFrom(ctx, signing, {
        assertion: { response: { authenticatorData: holes, clientDataJSON: sparse(1), signature: holes } },
      }),
    ).toEqual(REFUSED);
  });
});

/** Every value reachable from `value` through own members is frozen. */
const deeplyFrozen = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;

  seen.add(value);

  return Object.isFrozen(value) && Reflect.ownKeys(value).every((name) => deeplyFrozen((value as Record<PropertyKey, unknown>)[name], seen));
};

const passkeyConstants = Object.entries(core).filter(([name]) => name.startsWith('METHOD_PASSKEY_'));

describe('the exported constants', () => {
  it('there are passkey constants on the core entry, so the checks below are not vacuous', () => {
    expect(passkeyConstants.length).toBeGreaterThan(0);
    expect(core).toHaveProperty('METHOD_PASSKEY_MATERIAL_REJECTED');
  });

  it.each(passkeyConstants.filter(([name, value]) => typeof value === 'object' && value !== null && !name.endsWith('_ABI')))(
    '%s (a failure, record or list) is frozen, members included',
    (_name, value) => {
      expect(deeplyFrozen(value)).toBe(true);
    },
  );

  it('none is a parser table or a pattern: no Set, Map or RegExp is public', () => {
    for (const [name, value] of passkeyConstants) {
      expect([name, value instanceof Set || value instanceof Map || value instanceof RegExp]).toEqual([name, false]);
    }
  });

  it.each([
    'METHOD_PASSKEY_CONFIG_ABI',
    'METHOD_PASSKEY_CLIENT_DATA_OPENERS',
    'METHOD_PASSKEY_CLIENT_DATA_CLOSERS',
    'METHOD_PASSKEY_CLIENT_DATA_TOKEN',
    'METHOD_PASSKEY_UINT256_LIMIT',
    'METHOD_PASSKEY_WORD_HEX_LENGTH',
  ])('%s is gone from the core entry', (name) => {
    expect(core).not.toHaveProperty(name);
  });

  it('the material failure is frozen, and a caller writing to a returned failure changes no later failure', async () => {
    const input = method.enrollInput({ relyingPartyId: 'wallet.example', userName: 'alice' });
    const first = await method.configFrom(input, {});

    expect(first).toEqual(REFUSED);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { cause: string }).cause = 'device-refused';
    }).toThrow(TypeError);
    expect(await method.configFrom(input, {})).toEqual(REFUSED);
    expect(await method.replyFrom(ctxFor('0x12'), {} as Input, {})).toEqual(REFUSED);
  });

  it('the vector list is frozen', () => {
    expect(Object.isFrozen(method.vector)).toBe(true);
  });
});

describe('one config layout: the merged description ABI', () => {
  it('the config codec writes exactly abi.encode under DESCRIPTION_PASSKEY_CONFIG_ABI', () => {
    expect(core.DESCRIPTION_PASSKEY_CONFIG_ABI).toBeDefined();
    expect(codec.encodeConfig({ x, y, rpIdHash })).toBe(encodeAbiParameters(core.DESCRIPTION_PASSKEY_CONFIG_ABI, [x, y, rpIdHash]));
  });

  it('the method imports the merged ABI and declares no config layout of its own', () => {
    const sources = methodFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
    const constants = listSourceFiles(join(SRC_ROOT, 'constants'))
      .filter((path) => toPackagePath(path).startsWith('src/constants/method-passkey'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    expect(sources).toContain('DESCRIPTION_PASSKEY_CONFIG_ABI');
    expect(constants).not.toMatch(/\{\s*type:\s*'uint256'\s*\},\s*\{\s*type:\s*'uint256'\s*\},\s*\{\s*type:\s*'bytes32'\s*\}/);
  });
});

/** Member names the integrator's page and the browser objects carry, which the method must name as constants. */
const MEMBER_NAMES = [
  'relyingPartyId',
  'userName',
  'credentialId',
  'credential',
  'assertion',
  'response',
  'attestationObject',
  'authData',
  'authenticatorData',
  'clientDataJSON',
  'signature',
];

const ERROR_CLASSES = new Set(['Error', 'TypeError', 'RangeError', 'KitRefusalError']);

describe('the method source, against the conventions', () => {
  it('holds files to scan', () => {
    expect(methodFiles.length).toBeGreaterThan(0);
  });

  it('writes no member name as a quoted literal', () => {
    const found: string[] = [];

    for (const path of methodFiles) {
      walk(parseSource(path), (node) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && MEMBER_NAMES.includes(node.text)) {
          found.push(`${toPackagePath(path)}: '${node.text}'`);
        }
      });
    }

    expect(found).toEqual([]);
  });

  it('throws no plain Error, and writes no error message as literal text', () => {
    const found: string[] = [];

    for (const path of methodFiles) {
      const source = parseSource(path);

      walk(source, (node) => {
        if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || !ERROR_CLASSES.has(node.expression.text)) return;

        const where = `${toPackagePath(path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const message = node.arguments?.[0];

        if (node.expression.text === 'Error') found.push(`${where} plain Error`);

        if (message !== undefined && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) {
          found.push(`${where} literal message`);
        }

        if (message !== undefined && ts.isTemplateExpression(message)) {
          const parts = [message.head.text, ...message.templateSpans.map((span) => span.literal.text)];

          if (parts.some((part) => /[A-Za-z]/.test(part))) found.push(`${where} message with literal words`);
        }
      });
    }

    expect(found).toEqual([]);
  });

  it('lower-cases hex through the merged lowerHex, not a local cast', () => {
    const casts = methodFiles.filter((path) => /\.toLowerCase\(\)\s+as\s+Hex/.test(readFileSync(path, 'utf8'))).map(toPackagePath);

    expect(casts).toEqual([]);
  });
});

describe('the changeset names every public export the method adds', () => {
  const changeset = readFileSync(join(REPO_ROOT, '.changeset', 'social-recovery-method-passkey.md'), 'utf8');
  const program = createSourceProgram();
  const checker = program.getTypeChecker();
  const entry = requireSourceFile(program, join(SRC_ROOT, 'index.ts'));
  const added = [...resolveExports(checker, entry)]
    .filter(([, symbol]) =>
      (symbol.declarations ?? []).some((declaration) =>
        /^src\/(?:method-passkey\/|constants\/method-passkey|types\/method-passkey)/.test(toPackagePath(declaration.getSourceFile().fileName)),
      ),
    )
    .map(([name]) => name)
    .sort();

  it('the method adds public exports, the factory among them', () => {
    expect(added).toContain('passkeyMethod');
  });

  it('every one of them is named in the changeset', () => {
    const missing = added.filter((name) => !new RegExp(`\\b${name}\\b`).test(changeset));

    expect(missing).toEqual([]);
  });

  it('the changeset is a patch of this package', () => {
    expect(changeset).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---/);
  });
});

describe('the end-to-end path still holds under the stricter checks', () => {
  it('a stand-in credential enrolls to the hand-written config', async () => {
    const key = freshKey();
    const input: EnrollInput = method.enrollInput({ relyingPartyId: 'wallet.example', userName: 'alice' });

    expect(await method.configFrom(input, { credential: creation(key, 'wallet.example') })).toBe(configOfKey(key, 'wallet.example'));
  });
});
