import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/index';
import { FIRST_BLOCK, ProviderDouble, always, bySelector, type Answer } from './double';
import {
  ACCOUNT,
  ACTION,
  BOOL_PARAMS,
  MANAGER,
  METHOD,
  OTHER,
  PARTIES_PARAMS,
  POLICY_METHOD_ID_LITERAL,
  STRING_PARAMS,
  TRUE_WORD,
  lowerOf,
  partFor,
  sel,
  wordOf,
} from './fixtures';

const transport: Answer = { rejects: new Error('node unreachable') };
const ZERO = '0x0000000000000000000000000000000000000000';

describe('paused(module) under the exact-true rule', () => {
  it('reads paused() on the module at the read tag\'s block and answers stopped on exactly the true word', async () => {
    const provider = always({ returns: TRUE_WORD });

    expect(await partFor(provider).paused(METHOD)).toEqual({ answered: true, value: true });
    expect(provider.blockTags).toEqual(['latest']);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ to: METHOD, data: sel('paused'), block: FIRST_BLOCK });
    expect(sel('paused')).toBe('0x5c975abb');
  });

  it.each([
    ['an empty return', { returns: '0x' }],
    ['the false word', { returns: wordOf(0) }],
    ['the word 2', { returns: wordOf(2) }],
    ['the word with every bit set', { returns: `0x${'ff'.repeat(32)}` }],
    ['the true word followed by one byte', { returns: `${TRUE_WORD}00` }],
    ['the true word followed by a second word', { returns: `${TRUE_WORD}${'00'.repeat(32)}` }],
    ['a one-byte 0x01', { returns: '0x01' }],
    ['the true word cut to 31 bytes', { returns: `0x${'00'.repeat(30)}01` }],
    ['a true in the high byte', { returns: `0x01${'00'.repeat(31)}` }],
    ['a revert with no data', { reverts: '0x' }],
    ['a revert with an Error(string)', { reverts: `0x08c379a0${'00'.repeat(64)}` }],
    ['a revert whose data is the true word', { reverts: TRUE_WORD }],
  ] as const)('answers not stopped on %s', async (_case, answer) => {
    expect(await partFor(always(answer as Answer)).paused(METHOD)).toEqual({ answered: true, value: false });
  });

  it('reads a wallet or passkey method, which carries no paused() and reverts empty, as answered and not stopped', async () => {
    const provider = always({ reverts: '0x' });

    expect(await partFor(provider).paused(lowerOf(METHOD))).toEqual({ answered: true, value: false });
    expect(provider.calls[0]?.to).toBe(METHOD);
  });

  it.each([
    ['an Error', new Error('timeout')],
    ['a string', 'boom'],
    ['an object without data', { code: -32000 }],
    ['revert-shaped data that is not whole bytes', { data: '0x1' }],
    ['revert-shaped data that is not a string', { data: 1 }],
    ['null', null],
  ] as const)('answers nothing when the provider rejects with %s', async (_case, rejection) => {
    expect(await partFor(always({ rejects: rejection })).paused(METHOD)).toEqual({ answered: false });
  });

  it('answers nothing when the provider cannot name the block', async () => {
    const provider = always({ returns: TRUE_WORD });

    provider.blockFailure = new Error('node unreachable');

    expect(await partFor(provider).paused(METHOD)).toEqual({ answered: false });
    expect(provider.calls).toEqual([]);
  });
});

describe('trustedParties(module)', () => {
  const keys: Hex[] = [`0x${'AB'.repeat(32)}`, `0x${'01'.repeat(32)}`];
  const partiesReturn = encodeAbiParameters(PARTIES_PARAMS, [lowerOf(ACCOUNT), ZERO, keys, lowerOf(OTHER), lowerOf(ACTION)]);

  it('decodes the five declared values in order, addresses checksummed and keys lower-cased', async () => {
    const provider = always({ returns: partiesReturn });

    expect(await partFor(provider).trustedParties(METHOD)).toEqual({
      answered: true,
      value: {
        admin: ACCOUNT,
        pendingAdmin: ZERO,
        trustedKeys: [`0x${'ab'.repeat(32)}`, `0x${'01'.repeat(32)}`],
        pauseHolder: OTHER,
        pendingPauseHolder: ACTION,
      },
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ to: METHOD, data: sel('trustedParties'), block: FIRST_BLOCK });
    expect(sel('trustedParties')).toBe('0xa1e22a84');
  });

  it('decodes a return the provider spelled in upper-case hex to the same lower-case keys', async () => {
    const upper = `0x${partiesReturn.slice(2).toUpperCase()}` as Hex;
    const result = await partFor(always({ returns: upper })).trustedParties(METHOD);

    expect(result).toMatchObject({ answered: true, value: { trustedKeys: [`0x${'ab'.repeat(32)}`, `0x${'01'.repeat(32)}`], admin: ACCOUNT } });
  });

  it('decodes an empty key list', async () => {
    const empty = encodeAbiParameters(PARTIES_PARAMS, [ZERO, ZERO, [], ZERO, ZERO]);
    const result = await partFor(always({ returns: empty })).trustedParties(METHOD);

    expect(result).toEqual({ answered: true, value: { admin: ZERO, pendingAdmin: ZERO, trustedKeys: [], pauseHolder: ZERO, pendingPauseHolder: ZERO } });
  });

  it.each([
    ['a revert', { reverts: '0x' }],
    ['an empty return', { returns: '0x' }],
    ['a single word', { returns: TRUE_WORD }],
    ['the return cut short by one byte', { returns: partiesReturn.slice(0, -2) }],
    ['a provider failure', transport],
  ] as const)('answers nothing on %s', async (_case, answer) => {
    expect(await partFor(always(answer as Answer)).trustedParties(METHOD)).toEqual({ answered: false });
  });
});

describe('moduleInfo(module)', () => {
  const probeData = `0x01ffc9a7${POLICY_METHOD_ID_LITERAL.slice(2)}${'00'.repeat(28)}`;
  const named = (probe: Answer, name: Answer = { returns: encodeAbiParameters(STRING_PARAMS, ['EcdsaMethod']) }) =>
    bySelector({
      [sel('name')]: name,
      [sel('version')]: { returns: encodeAbiParameters(STRING_PARAMS, ['1.0.0']) },
      [sel('supportsInterface')]: probe,
    });

  it('reads name, version and the method-interface probe on the module, all at one pinned block', async () => {
    const provider = named({ returns: encodeAbiParameters(BOOL_PARAMS, [true]) });

    expect(await partFor(provider).moduleInfo(METHOD)).toEqual({
      answered: true,
      value: { name: 'EcdsaMethod', version: '1.0.0', supportsInterface: true },
    });
    expect(provider.blockTags).toEqual(['latest']);
    expect([...provider.selectors()].sort()).toEqual(['0x01ffc9a7', '0x06fdde03', '0x54fd4d50']);
    expect(provider.calls.every((call) => call.to === METHOD && call.block === FIRST_BLOCK)).toBe(true);
    expect(provider.calls.find((call) => call.data.startsWith('0x01ffc9a7'))?.data).toBe(probeData);
  });

  it.each([
    ['a false probe', { returns: wordOf(0) }],
    ['a reverting probe', { reverts: '0x' }],
    ['an empty probe return', { returns: '0x' }],
    ['a probe returning the word 2', { returns: wordOf(2) }],
    ['a probe returning the true word and a stray byte', { returns: `${TRUE_WORD}00` }],
  ] as const)('answers with supportsInterface false on %s', async (_case, probe) => {
    expect(await partFor(named(probe as Answer)).moduleInfo(METHOD)).toEqual({
      answered: true,
      value: { name: 'EcdsaMethod', version: '1.0.0', supportsInterface: false },
    });
  });

  it.each([
    ['name() reverts', { reverts: '0x' }],
    ['name() returns nothing', { returns: '0x' }],
    ['name() returns a bare word', { returns: TRUE_WORD }],
    ['name() fails at the provider', transport],
  ] as const)('answers nothing when %s', async (_case, name) => {
    expect(await partFor(named({ returns: TRUE_WORD }, name as Answer)).moduleInfo(METHOD)).toEqual({ answered: false });
  });

  it('answers nothing when version() reverts or the probe fails at the provider', async () => {
    const versionReverts = bySelector({
      [sel('name')]: { returns: encodeAbiParameters(STRING_PARAMS, ['EcdsaMethod']) },
      [sel('version')]: { reverts: '0x' },
      [sel('supportsInterface')]: { returns: TRUE_WORD },
    });

    expect(await partFor(versionReverts).moduleInfo(METHOD)).toEqual({ answered: false });
    expect(await partFor(named(transport)).moduleInfo(METHOD)).toEqual({ answered: false });
  });

  it('answers nothing when the provider cannot name the block', async () => {
    const provider = named({ returns: TRUE_WORD });

    provider.blockFailure = new Error('node unreachable');

    expect(await partFor(provider).moduleInfo(METHOD)).toEqual({ answered: false });
  });

  it('reads the module it was given, never the manager', async () => {
    const provider = named({ returns: TRUE_WORD });

    await partFor(provider).moduleInfo(OTHER);

    expect(provider.calls.some((call) => call.to === MANAGER)).toBe(false);
    expect(provider.calls.every((call) => call.to === OTHER)).toBe(true);
  });
});

describe('the module reads refuse a module address that breaks the address rule', () => {
  it.each(['moduleInfo', 'paused', 'trustedParties'] as const)('%s throws on a bad checksum before any read', async (member) => {
    const provider = new ProviderDouble();

    await expect(partFor(provider)[member]('0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9adb')).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });
});
