import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import { METHOD_AADHAAR_FRESHNESS_WINDOW, METHOD_AADHAAR_MIN_FRESHNESS_WINDOW } from '../../src/constants/method-aadhaar';
import {
  METHOD_AADHAAR_WINDOW_PARAM,
  METHOD_AADHAAR_WINDOW_RANGE_MESSAGE,
  METHOD_AADHAAR_WINDOW_TYPE_MESSAGE,
} from '../../src/constants/method-aadhaar-params';
import type { EnrollInput, Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { REPO_ROOT } from '../helpers/source';
import { CERTIFICATE, CONFIG_ABI, clockForFile, configBytes, ctxFor, FRESH_NOW, isFailure, pcdOf, QR_DATA, signalsFor, stackDouble, SYNTHETIC_UPSTREAM } from './fixtures';

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const WORD_MAX = (1n << 256n) - 1n;
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));

clockForFile(FRESH_NOW);

/** The window word of a config, read with viem against the layout written in the test. */
const windowOf = (config: unknown): bigint => decodeAbiParameters(CONFIG_ABI, config as Hex)[2];

/** The window an enrollment input carries, or `undefined`. */
const carried = (input: EnrollInput): unknown => (input as { readonly freshnessWindow?: unknown }).freshnessWindow;

/** What `enrollInput` threw for the params, or `undefined` when it returned. */
function enrollThrown(params: Record<string, unknown>): { readonly error: unknown; readonly calls: number } {
  const double = stackDouble({ pcd: boundPcd });

  try {
    anonAadhaarMethod({ stack: double.stack }).enrollInput(params);
  } catch (error) {
    return { error, calls: double.total() };
  }

  return { error: undefined, calls: double.total() };
}

describe('the window enrollment writes by default', () => {
  it('the default is 75 minutes, in seconds, above the one-hour minimum', () => {
    expect(METHOD_AADHAAR_FRESHNESS_WINDOW).toBe(4_500n);
    expect(METHOD_AADHAAR_FRESHNESS_WINDOW).toBeGreaterThan(METHOD_AADHAAR_MIN_FRESHNESS_WINDOW);
  });

  it('enrollInput without a window carries the default, and configFrom writes it as the third word', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const input = method.enrollInput(PARAMS);
    const config = await method.configFrom(input, { qrData: QR_DATA });

    expect(carried(input)).toBe(4_500n);
    expect(config).toBe(configBytes(22n, 77n, 4_500n));
    expect(windowOf(config)).toBe(4_500n);
    expect(double.order).toEqual(['generateArgs', 'prove']);
  });

  it('the param name and both messages are the published constants', () => {
    expect(METHOD_AADHAAR_WINDOW_PARAM).toBe('freshnessWindow');
    expect(METHOD_AADHAAR_WINDOW_TYPE_MESSAGE).toBe('must be a bigint or a safe integer');
    expect(METHOD_AADHAAR_WINDOW_RANGE_MESSAGE).toBe('must be at least 3600 seconds and fit a uint256');
  });
});

describe('the holder chooses the window at enrollment', () => {
  it.each([
    ['two hours as a safe integer', 7_200, 7_200n],
    ['two hours as a bigint', 7_200n, 7_200n],
    ['exactly the one-hour minimum', 3_600n, 3_600n],
    ['the minimum as a safe integer', 3_600, 3_600n],
    ['the largest word, the module having no ceiling', WORD_MAX, WORD_MAX],
  ] as const)('%s is carried as a bigint and written into the config', async (_why, freshnessWindow, expected) => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const input = method.enrollInput({ ...PARAMS, freshnessWindow });

    expect(carried(input)).toBe(expected);
    expect(double.total()).toBe(0);

    const config = await method.configFrom(input, { qrData: QR_DATA });

    expect(config).toBe(configBytes(22n, 77n, expected));
    expect(windowOf(config)).toBe(expected);
  });

  it('the window never reaches generateArgs: its options are the seed, certificate, QR and no reveal, as without it', async () => {
    const withWindow = stackDouble({ pcd: boundPcd });
    const without = stackDouble({ pcd: boundPcd });
    const chosen = anonAadhaarMethod({ stack: withWindow.stack });
    const plain = anonAadhaarMethod({ stack: without.stack });

    await chosen.configFrom(chosen.enrollInput({ ...PARAMS, freshnessWindow: 7_200n }), { qrData: QR_DATA });
    await plain.configFrom(plain.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(withWindow.generateArgsCalls).toHaveLength(1);
    expect(withWindow.generateArgsCalls).toEqual(without.generateArgsCalls);
    expect(Object.keys(withWindow.generateArgsCalls[0] ?? {})).not.toContain('freshnessWindow');
  });
});

describe('enrollInput refuses a window it cannot write, before any stack call', () => {
  it.each([
    ['one second under the hour', 3_599n],
    ['one second under the hour, as a number', 3_599],
    ['zero', 0n],
    ['2^256, past a uint256', 1n << 256n],
  ] as const)('%s is a RangeError naming freshnessWindow', (_why, freshnessWindow) => {
    const { error, calls } = enrollThrown({ ...PARAMS, freshnessWindow });

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain('freshnessWindow');
    expect((error as Error).message).toContain(METHOD_AADHAAR_WINDOW_RANGE_MESSAGE);
    expect(calls).toBe(0);
  });

  it.each([
    ['a decimal string', '7200'],
    ['a fractional number', 1.5],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['an object', { seconds: 7_200 }],
    ['null', null],
  ] as const)('%s is a TypeError naming freshnessWindow', (_why, freshnessWindow) => {
    const { error, calls } = enrollThrown({ ...PARAMS, freshnessWindow });

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('freshnessWindow');
    expect((error as Error).message).toContain(METHOD_AADHAAR_WINDOW_TYPE_MESSAGE);
    expect(calls).toBe(0);
  });

  it.each([-1, -1n])('a negative window %s is a TypeError or a RangeError naming freshnessWindow', (freshnessWindow) => {
    const { error, calls } = enrollThrown({ ...PARAMS, freshnessWindow });

    expect(error instanceof TypeError || error instanceof RangeError).toBe(true);
    expect((error as Error).message).toContain('freshnessWindow');
    expect(calls).toBe(0);
  });
});

describe('signingInput ignores the window, which the config holds', () => {
  const ctx = ctxFor(configBytes(22n, 77n, 7_200n), DIGEST);

  it.each([7_200n, 3_600n, 4_500])('a window of %s gives the same input as none', (freshnessWindow) => {
    const method = anonAadhaarMethod({ stack: stackDouble().stack });

    expect(method.signingInput(ctx, { ...PARAMS, freshnessWindow })).toEqual(method.signingInput(ctx, PARAMS));
    expect(Object.keys(method.signingInput(ctx, { ...PARAMS, freshnessWindow }))).not.toContain('freshnessWindow');
  });
});

describe('configFrom reads the window off the input', () => {
  /** An input of the shape enrollInput returned before the window param existed. */
  const earlier: EnrollInput = { kind: 'ceremony', nullifierSeed: 77n, certificateFile: CERTIFICATE, fieldsToRevealArray: [] };

  it('an input without a window, as built before this change, writes the default', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const config = await anonAadhaarMethod({ stack: double.stack }).configFrom(earlier, { qrData: QR_DATA });

    expect(config).toBe(configBytes(22n, 77n, METHOD_AADHAAR_FRESHNESS_WINDOW));
    expect(double.proveCalls).toHaveLength(1);
  });

  it.each([
    ['one second under the hour', 3_599n],
    ['2^256', 1n << 256n],
    ['a negative bigint', -1n],
    ['a decimal string', '7200'],
  ] as const)('a hand-built input whose window is %s is material-rejected and nothing is proved', async (_why, freshnessWindow) => {
    const double = stackDouble({ pcd: boundPcd });
    const result = await anonAadhaarMethod({ stack: double.stack }).configFrom({ ...earlier, freshnessWindow } as EnrollInput, { qrData: QR_DATA });

    expect(isFailure(result, 'material-rejected')).toBe(true);
    expect(double.proveCalls).toHaveLength(0);
  });

  it('a hand-built input whose window is a bigint of at least an hour writes that window', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const config = await anonAadhaarMethod({ stack: double.stack }).configFrom({ ...earlier, freshnessWindow: 3_600n } as EnrollInput, { qrData: QR_DATA });

    expect(config).toBe(configBytes(22n, 77n, 3_600n));
  });
});

describe('the freshness window\'s changeset', () => {
  const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-freshness-window.md'), 'utf8');

  it('is a patch naming the param, the new constants and member, with a Compatibility line for the changed default', () => {
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);

    for (const name of [
      'freshnessWindow',
      'METHOD_AADHAAR_FRESHNESS_WINDOW',
      'METHOD_AADHAAR_WINDOW_PARAM',
      'METHOD_AADHAAR_WINDOW_TYPE_MESSAGE',
      'METHOD_AADHAAR_WINDOW_RANGE_MESSAGE',
      'aadhaarWindows',
    ]) {
      expect(text, name).toContain(name);
    }

    expect(text).toContain('Compatibility');
    expect(text).not.toMatch(/^\s*(\*\*)?breaking/im);
  });
});
