import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  METHOD_ZKPASSPORT_DISPLAY_MESSAGE,
  METHOD_ZKPASSPORT_DOMAIN_MESSAGE,
  METHOD_ZKPASSPORT_MATERIAL_REJECTED,
  METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED,
  METHOD_ZKPASSPORT_TRUSTED_KEY_COUNT,
  METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE,
} from '../../src/constants';
import { REPLY_FAILURE_CAUSES, type EnrollInput, type Hex, type Input, type Material } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { ZkPassportSession } from '../../src/types';
import { jsDocOf, PACKAGE_ROOT, SRC_ROOT } from '../helpers/source';
import {
  asHex,
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  outerInputs,
  PARAMS,
  sparse,
  stackDouble,
  stackProof,
  word,
  type OuterMaterial,
  type StackCall,
  type StackDoubleOptions,
} from './fixtures';

/** A version word written here: major, minor and patch as three big-endian uint16, then zeros. */
const versionWord = (major: number, minor: number, patch: number): Hex =>
  `0x${[major, minor, patch].map((part) => part.toString(16).padStart(4, '0')).join('')}${'0'.repeat(52)}`;

const V0_21_0 = versionWord(0, 21, 0);
const V0_21_2 = versionWord(0, 21, 2);

/** Eight trusted-key words as the module reports them, the given version first and the root guardian's word zero. */
const keysWith = (version: string): Hex[] => [version as Hex, word(0xa1), word(0xa2), word(0xa3), word(0xa4), word(0xa5), word(0), word(0xa7)];

const upper = (value: string): Hex => `0x${value.slice(2).toUpperCase()}`;

const untrusted = { kind: 'reply-failure', cause: 'material-untrusted' };

const CONFIG = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, 604800n);

const PROOF = encodeProof(asHex(DEFAULT_OUTER.vkeyHash), asHex(DEFAULT_OUTER.proof), DEFAULT_OUTER.publicInputs.map(asHex), asHex(DEFAULT_OUTER.committedInputs));

const enrollMaterial = (overrides: { readonly [member: string]: unknown } = {}): Material => ({
  result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('outer_evm_count_4')], ...overrides },
});

const REPLY_MATERIAL: Material = { proofs: [stackProof('outer_evm_count_5', DIGEST)] };

const withVersion = (version: string): OuterMaterial => ({ ...DEFAULT_OUTER, version });

const counted = (calls: readonly StackCall[]) => ({
  construct: calls.filter((call) => call.kind === 'construct').length,
  verifier: calls.filter((call) => call.kind === 'verifier-parameters').length,
});

/** One enrollment and one reply through a fresh double each, under the given params. */
async function bothSides(params: { readonly [name: string]: unknown }, options: StackDoubleOptions = {}) {
  const enrolling = stackDouble(options);
  const replying = stackDouble(options);
  const enrollMethod = zkPassportMethod({ stack: enrolling.stack });
  const replyMethod = zkPassportMethod({ stack: replying.stack });
  const ctx = makeCtx(CONFIG);
  const config = await enrollMethod.configFrom(enrollMethod.enrollInput(params), enrollMaterial());
  const proof = await replyMethod.replyFrom(ctx, replyMethod.signingInput(ctx, params), REPLY_MATERIAL);

  return { config, proof, enrolling: enrolling.calls, replying: replying.calls };
}

describe('the version the stack reports against trustedKeys[0]', () => {
  it('the suite\'s own version words: the double reports 0.21.2', () => {
    expect(DEFAULT_OUTER.version).toBe(V0_21_2);
    expect(V0_21_0).toBe(`0x000000150000${'0'.repeat(52)}`);
  });

  it.each([
    ['as read, lower case', keysWith(V0_21_2)],
    ['upper-cased', keysWith(V0_21_2).map(upper)],
    ['word 0 alone upper-cased', keysWith(upper(V0_21_2))],
  ])('trustedKeys whose word 0 is the reported version, %s, give today\'s config and proof bytes', async (_how, trustedKeys) => {
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys });

    expect(config).toBe(CONFIG);
    expect(proof).toBe(PROOF);
  });

  it.each([
    ['0.21.0 against a reported 0.21.2', V0_21_2, V0_21_0],
    ['0.21.2 against a reported 0.21.0', V0_21_0, V0_21_2],
    ['a patch one higher', V0_21_2, versionWord(0, 21, 3)],
    ['another major alone', V0_21_2, versionWord(1, 21, 2)],
    ['0.0.0, the zero word', V0_21_2, versionWord(0, 0, 0)],
  ])('word 0 of %s is material-untrusted at configFrom and replyFrom, after one stack load and one verifier call each', async (_why, reported, accepted) => {
    const { config, proof, enrolling, replying } = await bothSides({ ...PARAMS, trustedKeys: keysWith(accepted) }, { outer: withVersion(reported) });

    expect(config).toEqual(untrusted);
    expect(proof).toEqual(untrusted);
    expect(counted(enrolling)).toEqual({ construct: 1, verifier: 1 });
    expect(counted(replying)).toEqual({ construct: 1, verifier: 1 });
  });

  it('the refusal is the frozen METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED record', async () => {
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys: keysWith(V0_21_0) });

    expect(METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED).toEqual(untrusted);
    expect(Object.isFrozen(METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED)).toBe(true);
    expect(config).toBe(METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED);
    expect(proof).toBe(METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED);
  });

  it('only word 0 is compared: the other seven words may be any words', async () => {
    const trustedKeys = [V0_21_2, ...Array.from({ length: 7 }, (_, index) => word(BigInt(index) << 200n))];
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys });

    expect(config).toBe(CONFIG);
    expect(proof).toBe(PROOF);
  });
});

describe('without trustedKeys nothing changes', () => {
  it.each([
    ['the double\'s 0.21.2', V0_21_2],
    ['0.21.0', V0_21_0],
    ['a text that is no version', 'banana'],
    ['bare 0x', '0x'],
    ['a dotted version', '0.21.2'],
  ])('a reported version of %s gives today\'s config and proof bytes', async (_why, version) => {
    const { config, proof } = await bothSides(PARAMS, { outer: withVersion(version) });

    expect(config).toBe(CONFIG);
    expect(proof).toBe(PROOF);
  });

  it('the input records carry no trustedKeys member, and with keys they carry them lower-cased', () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });
    const keys = keysWith(upper(V0_21_2)).map(upper);

    expect(Object.keys(method.enrollInput(PARAMS))).not.toContain('trustedKeys');
    expect(Object.keys(method.signingInput(makeCtx(CONFIG), PARAMS))).not.toContain('trustedKeys');
    expect(method.enrollInput({ ...PARAMS, trustedKeys: keys })['trustedKeys']).toEqual(keysWith(V0_21_2));
    expect(method.signingInput(makeCtx(CONFIG), { ...PARAMS, trustedKeys: keys })['trustedKeys']).toEqual(keysWith(V0_21_2));
  });
});

/** Values `trustedKeys` may not take, each refused before any stack call. */
const MALFORMED: readonly (readonly [string, unknown])[] = [
  ['a single word, not a list', V0_21_2],
  ['null', null],
  ['a record indexed like a list', { 0: V0_21_2 }],
  ['an empty list', []],
  ['seven words', keysWith(V0_21_2).slice(0, 7)],
  ['nine words', [...keysWith(V0_21_2), word(1)]],
  ['word 0 of one byte', keysWith('0x00')],
  ['word 0 not hex', keysWith(`0x${'zz'.repeat(32)}`)],
  ['word 0 without 0x', keysWith(V0_21_2.slice(2))],
  ['word 0 a number', [21, ...keysWith(V0_21_2).slice(1)]],
  ['word 0 a 32-byte word with a non-zero tail', keysWith(`0x000000150002${'0'.repeat(50)}01`)],
  ['word 5 of 31 bytes', keysWith(V0_21_2).map((key, index) => (index === 5 ? `0x${'11'.repeat(31)}` : key))],
  ['word 3 a bigint', keysWith(V0_21_2).map((key, index) => (index === 3 ? 3n : key))],
  ['a hole at word 2', sparse(8, { 0: V0_21_2, 1: word(1), 3: word(3), 4: word(4), 5: word(5), 6: word(6), 7: word(7) })],
];

describe('a malformed trustedKeys is refused where the params are taken', () => {
  it('the refusal message names trustedKeys, and the module holds eight words', () => {
    expect(METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE).toBe(
      'method-zkpassport: "trustedKeys" must be the module\'s 8 trusted-key words of 32 bytes each, the first a version word: major, minor and patch as three big-endian uint16 values and zero after them',
    );
    expect(METHOD_ZKPASSPORT_TRUSTED_KEY_COUNT).toBe(8);
  });

  it.each(MALFORMED)('enrollInput and signingInput throw the TypeError for %s, and ask the stack nothing', (_why, trustedKeys) => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });
    const params = { ...PARAMS, trustedKeys } as never;

    expect(() => method.enrollInput(params)).toThrow(new TypeError(METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE));
    expect(() => method.signingInput(makeCtx(CONFIG), params)).toThrow(new TypeError(METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE));
    expect(double.calls).toEqual([]);
  });

  it('the domain and display checks keep their place before the keys check', () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });

    expect(() => method.enrollInput({ ...PARAMS, domain: `https://${PARAMS.domain}`, trustedKeys: [] } as never)).toThrow(new TypeError(METHOD_ZKPASSPORT_DOMAIN_MESSAGE));
    expect(() => method.enrollInput({ ...PARAMS, name: 5, trustedKeys: [] } as never)).toThrow(new TypeError(METHOD_ZKPASSPORT_DISPLAY_MESSAGE));
  });

  it.each(MALFORMED)('an input built by hand with %s is material-rejected at configFrom and replyFrom, and the stack is not asked', async (_why, trustedKeys) => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });
    const ctx = makeCtx(CONFIG);
    const enrolling: EnrollInput = { ...method.enrollInput(PARAMS), trustedKeys };
    const signing: Input = { ...method.signingInput(ctx, PARAMS), trustedKeys };

    await expect(method.configFrom(enrolling, enrollMaterial())).resolves.toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    await expect(method.replyFrom(ctx, signing, REPLY_MATERIAL)).resolves.toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(double.calls).toEqual([]);
  });
});

describe('the version check keeps its place among the other refusals', () => {
  it.each([
    ['a text that is no version', 'banana'],
    ['bare 0x', '0x'],
    ['a dotted version', '0.21.2'],
    ['hex with a non-hex digit', `0x${'zz'.repeat(32)}`],
  ])('with trustedKeys given, a reported version that is %s is material-rejected', async (_why, version) => {
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys: keysWith(V0_21_2) }, { outer: withVersion(version) });

    expect(config).toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(proof).toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  });

  it('a config whose domain no request can be made for is request-unsupported before the stack is asked, whatever the keys', async () => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });
    const ctx = makeCtx(encodeConfig(word(IDENTIFIER), `https://${PARAMS.domain}`, PARAMS.scope, 604800n));

    await expect(method.replyFrom(ctx, method.signingInput(ctx, { ...PARAMS, trustedKeys: keysWith(V0_21_0) }), REPLY_MATERIAL)).resolves.toEqual({
      kind: 'reply-failure',
      cause: 'request-unsupported',
    });
    expect(double.calls).toEqual([]);
  });

  it('a result that did not verify is material-rejected before the stack is asked, whatever the keys', async () => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });

    await expect(
      method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: keysWith(V0_21_0) }), enrollMaterial({ verified: false })),
    ).resolves.toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(double.calls).toEqual([]);
  });

  it('a stack echoing the other dev mode is material-rejected before the version is compared', async () => {
    const otherMode = { serviceConfig: (args: { domain: string; scope: string }) => ({ validityPeriodInSeconds: 604800, domain: args.domain, scope: args.scope, devMode: true }) };
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys: keysWith(V0_21_0) }, otherMode);

    expect(config).toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
    expect(proof).toEqual(METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  });

  it('another version is material-untrusted before the proof\'s bindings are judged: a salted nullifier under it still answers untrusted', async () => {
    const outer = { ...withVersion(V0_21_2), publicInputs: outerInputs(IDENTIFIER, 1n) };
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys: keysWith(V0_21_0) }, { outer });

    expect(config).toEqual(untrusted);
    expect(proof).toEqual(untrusted);
  });

  it('a stack that cannot load is still device-unavailable, whatever the keys', async () => {
    const { config, proof } = await bothSides({ ...PARAMS, trustedKeys: keysWith(V0_21_0) }, { constructThrows: true });

    expect(config).toEqual({ kind: 'reply-failure', cause: 'device-unavailable' });
    expect(proof).toEqual({ kind: 'reply-failure', cause: 'device-unavailable' });
  });

  it('verify reads no version and loads no stack', async () => {
    const double = stackDouble({ outer: withVersion(V0_21_0) });

    await expect(zkPassportMethod({ stack: double.stack }).verify(makeCtx(CONFIG), PROOF)).resolves.toBe('not-judged');
    expect(double.calls).toEqual([]);
  });
});

describe('the shared cause and the session member', () => {
  it('REPLY_FAILURE_CAUSES holds material-untrusted directly after material-rejected', () => {
    const at = REPLY_FAILURE_CAUSES.indexOf('material-rejected');

    expect(REPLY_FAILURE_CAUSES[at + 1]).toBe('material-untrusted');
  });

  it('the session takes the keys as an optional read-only list of words', () => {
    expectTypeOf<ZkPassportSession['trustedKeys']>().toEqualTypeOf<readonly Hex[] | undefined>();
    expect(jsDocOf(join(SRC_ROOT, 'types', 'method-zkpassport.ts'), 'trustedKeys', 'ZkPassportSession')).not.toBe('');
  });

  it.each(['enrollInput', 'configFrom', 'signingInput', 'replyFrom'])('%s documents trustedKeys and the refusal', (name) => {
    const doc = jsDocOf(join(SRC_ROOT, 'method-zkpassport', 'zkpassport-method.ts'), name, 'ZkPassportMethod');

    expect(doc).toContain('trustedKeys');
  });

  it.each(['configFrom', 'replyFrom'])('%s names material-untrusted', (name) => {
    expect(jsDocOf(join(SRC_ROOT, 'method-zkpassport', 'zkpassport-method.ts'), name, 'ZkPassportMethod')).toContain('material-untrusted');
  });
});

describe('the accepted version\'s changeset', () => {
  const text = (): string => readFileSync(join(PACKAGE_ROOT, '..', '..', '.changeset', 'zkpassport-accepted-version.md'), 'utf8');

  it('is a patch of the package naming the param, the cause and both constants, and never names the factory', () => {
    expect(text()).toMatch(/['"]@kohaku-eth\/social-recovery['"]\s*:\s*patch/);

    for (const name of ['trustedKeys', 'material-untrusted', 'METHOD_ZKPASSPORT_MATERIAL_UNTRUSTED', 'METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE']) {
      expect(text()).toContain(name);
    }

    expect(text()).not.toContain('zkPassportMethod');
  });
});
