import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLY_FAILURE_CAUSES } from '../../src/index';
import { METHOD_AADHAAR_MATERIAL_UNTRUSTED } from '../../src/constants/method-aadhaar';
import { METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE, METHOD_AADHAAR_TRUSTED_KEYS_PARAM } from '../../src/constants/method-aadhaar-params';
import type { EnrollInput, Hex, Input } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { REPO_ROOT } from '../helpers/source';
import {
  CERTIFICATE,
  clockAt,
  configBytes,
  ctxFor,
  FRESH_NOW,
  FRESHNESS_WINDOW,
  isFailure,
  pcdOf,
  QR_DATA,
  SIGNED_AT,
  signalsFor,
  stackDouble,
  SYNTHETIC_UPSTREAM,
  type DoubleOptions,
} from './fixtures';

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const CONFIG = configBytes(22n, 77n);
const ctx = ctxFor(CONFIG, DIGEST);

/** The key hash the doubles prove under, and its 32-byte word as the module's `trustedParties` reads it. */
const H = (0x2a5fn << 232n) | 0xc0den;
const H_WORD: Hex = `0x${H.toString(16).padStart(64, '0')}`;

/** Another key's word: one bit away from H. */
const OTHER_WORD: Hex = `0x${(H ^ 1n).toString(16).padStart(64, '0')}`;

/** Upstream's test public-key hash, public input 0 of the contracts' real-proof fixture, and its 32-byte word. */
const UPSTREAM_TEST_KEY = 15134874015316324267425466444584014077184337590635665158241104437045239495873n;
const UPSTREAM_TEST_KEY_WORD: Hex = '0x217608fddff9ccea4198e5674875e703458f8700115ef34bbee6ae94a3c83cc1';

const pcdUnder = (pubkeyHash: bigint, overrides = {}) => pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST, { pubkeyHash, ...overrides }));

/** A method over a double proving under `pubkeyHash`, and the double. */
function build(pubkeyHash: bigint, options: DoubleOptions = {}) {
  const double = stackDouble({ pcd: pcdUnder(pubkeyHash), ...options });

  return { double, method: anonAadhaarMethod({ stack: double.stack }) };
}

const keyOf = (input: unknown): unknown => (input as { readonly trustedKey?: unknown }).trustedKey;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the trustedKeys param', () => {
  it('the param name and message are published constants, and the refusal a frozen typed record', () => {
    expect(METHOD_AADHAAR_TRUSTED_KEYS_PARAM).toBe('trustedKeys');
    expect(typeof METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE).toBe('string');
    expect(METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE.length).toBeGreaterThan(0);
    expect(METHOD_AADHAAR_MATERIAL_UNTRUSTED).toEqual({ kind: 'reply-failure', cause: 'material-untrusted' });
    expect(Object.isFrozen(METHOD_AADHAAR_MATERIAL_UNTRUSTED)).toBe(true);
    expect(REPLY_FAILURE_CAUSES).toContain(METHOD_AADHAAR_MATERIAL_UNTRUSTED.cause);
  });

  it('the new cause sits directly after material-rejected, six causes in all', () => {
    expect(REPLY_FAILURE_CAUSES).toHaveLength(6);
    expect(REPLY_FAILURE_CAUSES.indexOf('material-untrusted')).toBe(REPLY_FAILURE_CAUSES.indexOf('material-rejected') + 1);
  });

  it('one word is copied onto both inputs as a bigint, and nothing else changes', () => {
    const { double, method } = build(H);

    expect(method.enrollInput({ ...PARAMS, trustedKeys: [H_WORD] })).toEqual({ ...method.enrollInput(PARAMS), trustedKey: H });
    expect(method.signingInput(ctx, { ...PARAMS, trustedKeys: [H_WORD] })).toEqual({ ...method.signingInput(ctx, PARAMS), trustedKey: H });
    expect(double.total()).toBe(0);
  });

  it('absent, neither input carries a trusted key', () => {
    const { method } = build(H);

    expect(Object.keys(method.enrollInput(PARAMS))).not.toContain('trustedKey');
    expect(Object.keys(method.signingInput(ctx, PARAMS))).not.toContain('trustedKey');
  });

  it('an upper-case word is the same key by value', () => {
    const { method } = build(H);
    const upper = `0x${H_WORD.slice(2).toUpperCase()}` as Hex;

    expect(keyOf(method.enrollInput({ ...PARAMS, trustedKeys: [upper] }))).toBe(H);
    expect(keyOf(method.signingInput(ctx, { ...PARAMS, trustedKeys: [upper] }))).toBe(H);
  });

  it.each([
    ['a bare word, not an array', H_WORD],
    ['an empty array', []],
    ['two words', [H_WORD, H_WORD]],
    ['two different words', [H_WORD, OTHER_WORD]],
    ['a 31-byte word', [`0x${'ab'.repeat(31)}`]],
    ['a 33-byte word', [`0x${'ab'.repeat(33)}`]],
    ['a word without its prefix', [H_WORD.slice(2)]],
    ['a word that is not hex', [`0x${'zz'.repeat(32)}`]],
    ['a bigint rather than a word', [H]],
    ['an object', { 0: H_WORD, length: 1 }],
    ['a number', 7],
    ['null', null],
  ] as const)('%s is a TypeError naming trustedKeys at both calls, before any stack call', (_why, trustedKeys) => {
    const { double, method } = build(H);
    const enroll = (): unknown => method.enrollInput({ ...PARAMS, trustedKeys } as never);
    const sign = (): unknown => method.signingInput(ctx, { ...PARAMS, trustedKeys } as never);

    for (const call of [enroll, sign]) {
      let error: unknown;

      try {
        call();
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain('trustedKeys');
    }

    expect(double.total()).toBe(0);
  });

  it('the recorded upstream test key, public input 0 of the contracts\' real proof, is the bigint of its 32-byte word', () => {
    const { method } = build(UPSTREAM_TEST_KEY);

    expect(BigInt(UPSTREAM_TEST_KEY_WORD)).toBe(UPSTREAM_TEST_KEY);
    expect(UPSTREAM_TEST_KEY_WORD).toHaveLength(2 + 64);
    expect(keyOf(method.enrollInput({ ...PARAMS, trustedKeys: [UPSTREAM_TEST_KEY_WORD] }))).toBe(UPSTREAM_TEST_KEY);
  });
});

describe('configFrom compares the proof\'s issuer key after proving', () => {
  it('the trusted word matching the proof gives the config', async () => {
    const { double, method } = build(H);

    expect(await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [H_WORD] }), { qrData: QR_DATA })).toBe(configBytes(22n, 77n, FRESHNESS_WINDOW));
    expect(double.proveCalls).toHaveLength(1);
  });

  it('another word gives material-untrusted after one proof', async () => {
    const { double, method } = build(H);
    const result = await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [OTHER_WORD] }), { qrData: QR_DATA });

    expect(result).toEqual(METHOD_AADHAAR_MATERIAL_UNTRUSTED);
    expect(isFailure(result, 'material-untrusted')).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(double.order).toEqual(['generateArgs', 'prove']);
  });

  it('no word gives the config, whatever key the proof carries', async () => {
    const { method } = build(H ^ 1n);

    expect(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA })).toBe(configBytes(22n, 77n, FRESHNESS_WINDOW));
  });

  it('an upper-case word matching the proof gives the config', async () => {
    const { method } = build(H);
    const upper = `0x${H_WORD.slice(2).toUpperCase()}` as Hex;

    expect(typeof (await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [upper] }), { qrData: QR_DATA }))).toBe('string');
  });

  it('a seed mismatch under another key stays material-rejected', async () => {
    const double = stackDouble({ pcd: pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 78n, DIGEST, { pubkeyHash: H })) });
    const method = anonAadhaarMethod({ stack: double.stack });

    expect(isFailure(await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [OTHER_WORD] }), { qrData: QR_DATA }), 'material-rejected')).toBe(true);
  });

  it('an aborted signal is device-refused, never material-untrusted', async () => {
    const { double, method } = build(H);
    const result = await method.configFrom(method.enrollInput({ ...PARAMS, trustedKeys: [OTHER_WORD] }), { qrData: QR_DATA, signal: AbortSignal.abort() });

    expect(isFailure(result, 'device-refused')).toBe(true);
    expect(double.total()).toBe(0);
  });
});

describe('replyFrom compares the proof\'s issuer key after the freshness check, before the local verdict', () => {
  const reply = (method: ReturnType<typeof anonAadhaarMethod>, trustedKeys?: readonly Hex[], signal?: AbortSignal) =>
    method.replyFrom(ctx, method.signingInput(ctx, trustedKeys === undefined ? PARAMS : { ...PARAMS, trustedKeys }), {
      qrData: QR_DATA,
      ...(signal === undefined ? {} : { signal }),
    });

  it('another word than the proof\'s key is material-untrusted, and verify is never called', async () => {
    clockAt(FRESH_NOW);

    const { double, method } = build(H);
    const result = await reply(method, [OTHER_WORD]);

    expect(result).toEqual(METHOD_AADHAAR_MATERIAL_UNTRUSTED);
    expect(double.verifyCalls).toHaveLength(0);
    expect(double.order).toEqual(['generateArgs', 'prove']);
  });

  it('the matching word with a verify that throws hands the proof on, not-judged left to the chain', async () => {
    clockAt(FRESH_NOW);

    const { double, method } = build(H, { verify: 'throw' });
    const result = await reply(method, [H_WORD]);

    expect(typeof result).toBe('string');
    expect(((result as Hex).length - 2) / 2).toBe(544);
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('the matching word with a verify answering true returns the proof, and false is material-rejected', async () => {
    clockAt(FRESH_NOW);

    expect(typeof (await reply(build(H, { verify: true }).method, [H_WORD]))).toBe('string');
    expect(isFailure(await reply(build(H, { verify: false }).method, [H_WORD]), 'material-rejected')).toBe(true);
  });

  it('no word leaves every key to the local verdict as before', async () => {
    clockAt(FRESH_NOW);

    const { double, method } = build(H ^ 1n, { verify: 'throw' });

    expect(typeof (await reply(method))).toBe('string');
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('a nullifier mismatch under another key stays material-rejected', async () => {
    clockAt(FRESH_NOW);

    const double = stackDouble({ pcd: pcdUnder(H, { nullifier: 23n }) });
    const method = anonAadhaarMethod({ stack: double.stack });

    expect(isFailure(await reply(method, [OTHER_WORD]), 'material-rejected')).toBe(true);
    expect(double.verifyCalls).toHaveLength(0);
  });

  it('a stale QR under another key stays material-rejected', async () => {
    clockAt(SIGNED_AT + FRESHNESS_WINDOW + 1n);

    const { double, method } = build(H);

    expect(isFailure(await reply(method, [OTHER_WORD]), 'material-rejected')).toBe(true);
    expect(double.verifyCalls).toHaveLength(0);
  });

  it('an aborted signal is device-refused, before or during the proof', async () => {
    clockAt(FRESH_NOW);

    const before = build(H);

    expect(isFailure(await reply(before.method, [OTHER_WORD], AbortSignal.abort()), 'device-refused')).toBe(true);
    expect(before.double.total()).toBe(0);

    const during = build(H, { prove: 'hang' });
    const controller = new AbortController();
    const pending = reply(during.method, [OTHER_WORD], controller.signal);

    await during.double.proving;
    controller.abort();

    expect(isFailure(await pending, 'device-refused')).toBe(true);
  });
});

describe('a hand-built input whose trusted key is malformed reads as unreadable', () => {
  it.each([
    ['a string', '0x01'],
    ['a negative bigint', -1n],
    ['2^256', 1n << 256n],
  ] as const)('%s: configFrom and replyFrom are material-rejected with nothing proved', async (_why, trustedKey) => {
    clockAt(FRESH_NOW);

    const { double, method } = build(H);
    const enroll = { ...method.enrollInput(PARAMS), trustedKey } as EnrollInput;
    const sign = { ...method.signingInput(ctx, PARAMS), trustedKey } as Input;

    expect(isFailure(await method.configFrom(enroll, { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    expect(isFailure(await method.replyFrom(ctx, sign, { qrData: QR_DATA }), 'material-rejected')).toBe(true);
    expect(double.proveCalls).toHaveLength(0);
  });

  it('a hand-built input whose trusted key is the proof\'s bigint gives the config and the proof', async () => {
    clockAt(FRESH_NOW);

    const { method } = build(H);

    expect(typeof (await method.configFrom({ ...method.enrollInput(PARAMS), trustedKey: H } as EnrollInput, { qrData: QR_DATA }))).toBe('string');
    expect(typeof (await method.replyFrom(ctx, { ...method.signingInput(ctx, PARAMS), trustedKey: H } as Input, { qrData: QR_DATA }))).toBe('string');
  });
});

describe('the issuer key check\'s changeset', () => {
  const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-issuer-key-check.md'), 'utf8');

  it('is a patch naming the param, the cause and the constants, where the word comes from, and a Compatibility line', () => {
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);

    for (const name of ['trustedKeys', 'material-untrusted', 'METHOD_AADHAAR_MATERIAL_UNTRUSTED', 'METHOD_AADHAAR_TRUSTED_KEYS_PARAM', 'METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE', 'trustedParties']) {
      expect(text, name).toContain(name);
    }

    expect(text).toContain('Compatibility');
    expect(text).not.toMatch(/^\s*(\*\*)?breaking/im);
  });
});
