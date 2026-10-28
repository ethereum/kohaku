import { describe, expect, it } from 'vitest';
import { POLICY_ACTION_INTERFACE_ID, type Hex } from '../../src/index';
import { ACTION, BLOCK_TAGS, boolWord, partOver, POLICY_ACTION_SIGNATURES, SELECTORS, stringReturn, word, xorSelectors } from './fixtures';
import { HEADER, providerDouble, type CallAnswer } from './provider-double';

const NAME = 'Ambire recovery action';
const VERSION = '1.0.0';

const answers = (overrides: Readonly<Record<string, CallAnswer>> = {}): Readonly<Record<string, CallAnswer>> => ({
  [SELECTORS.name]: { returns: stringReturn(NAME) },
  [SELECTORS.version]: { returns: stringReturn(VERSION) },
  [SELECTORS.supportsInterface]: { returns: boolWord(true) },
  ...overrides,
});

const infoWith = (overrides: Readonly<Record<string, CallAnswer>> = {}) => partOver(providerDouble(answers(overrides)).provider).actionInfo();

describe('POLICY_ACTION_INTERFACE_ID', () => {
  it('is the XOR of the six policy-action selectors', () => {
    expect(xorSelectors(POLICY_ACTION_SIGNATURES)).toBe('0x59cd148e');
    expect(POLICY_ACTION_INTERFACE_ID).toBe('0x59cd148e');
  });
});

describe('actionInfo', () => {
  it('returns the name, the version and the probe answer', async () => {
    await expect(infoWith()).resolves.toEqual({ name: NAME, version: VERSION, supportsInterface: true });
  });

  it('carries a probe answering false', async () => {
    await expect(infoWith({ [SELECTORS.supportsInterface]: { returns: boolWord(false) } })).resolves.toEqual({
      name: NAME,
      version: VERSION,
      supportsInterface: false,
    });
  });

  it('asks the bound action for name, version and the policy-action interface, each once, at one resolved block', async () => {
    const double = providerDouble(answers());

    await partOver(double.provider).actionInfo();
    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls).toHaveLength(3);
    expect(double.calls.every((seen) => seen.to.toLowerCase() === ACTION && seen.block === HEADER.number)).toBe(true);
    expect(double.calls.map((seen) => seen.data.toLowerCase()).sort()).toEqual(
      [SELECTORS.name, SELECTORS.version, `${SELECTORS.supportsInterface}${'59cd148e'.padEnd(64, '0')}`].sort(),
    );
    expect([double.codeReads, double.logReads]).toEqual([0, 0]);
  });

  it('reads empty and multi-word strings', async () => {
    const long = 'x'.repeat(70);

    await expect(
      infoWith({ [SELECTORS.name]: { returns: stringReturn('') }, [SELECTORS.version]: { returns: stringReturn(long) } }),
    ).resolves.toEqual({ name: '', version: long, supportsInterface: true });
  });

  it('reads a reverting probe as not supported', async () => {
    await expect(infoWith({ [SELECTORS.supportsInterface]: { rejects: { data: '0x' } } })).resolves.toEqual({
      name: NAME,
      version: VERSION,
      supportsInterface: false,
    });
  });

  it.each([
    ['empty', '0x'],
    ['a word of 2', `0x${word('2')}`],
    ['31 bytes', `0x${'0'.repeat(61)}1`],
  ])('reads a malformed probe return (%s) as not supported', async (_label, returns) => {
    await expect(infoWith({ [SELECTORS.supportsInterface]: { returns: returns as Hex } })).resolves.toMatchObject({
      supportsInterface: false,
    });
  });

  it.each(['name', 'version'] as const)('rejects with the revert when %s reverts', async (member) => {
    const revert = { data: '0xdeadbeef' as Hex };

    await expect(infoWith({ [SELECTORS[member]]: { rejects: revert } })).rejects.toBe(revert);
  });

  it.each(['name', 'version'] as const)('rejects with a TypeError when %s returns undecodable bytes', async (member) => {
    await expect(infoWith({ [SELECTORS[member]]: { returns: '0x01' } })).rejects.toThrow(TypeError);
    await expect(infoWith({ [SELECTORS[member]]: { returns: '0x' } })).rejects.toThrow(TypeError);
  });

  it.each(['name', 'version'] as const)('rethrows a transport failure of %s as raised', async (member) => {
    const failure = new Error('timeout');

    await expect(infoWith({ [SELECTORS[member]]: { rejects: failure } })).rejects.toBe(failure);
  });
});
