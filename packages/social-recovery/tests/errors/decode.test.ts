import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeRevert, type Hex } from '../../src/index';
import {
  ACTION_ROWS,
  ERROR_STRING_SELECTOR,
  expectedValue,
  KIT_ROWS,
  MANAGER_ROWS,
  PANIC_SELECTOR,
  revertData,
  rowNamed,
  samplesFor,
} from './rows';

describe('decodeRevert names every declared error with its arguments', () => {
  it.each(KIT_ROWS.map((entry, index) => [entry.name, entry, index] as const))('%s', (_name, entry, index) => {
    const values = samplesFor(entry, index * 7 + 1);
    const result = decodeRevert(revertData(entry, values));
    const args = Object.fromEntries(entry.inputs.map((input, at) => [input.name, expectedValue(input.type, values[at] ?? 0n)]));

    expect(result).toEqual({ known: true, source: entry.source, name: entry.name, selector: entry.selector, args });
  });

  it('attributes the twenty-two manager rows to the manager and the six action rows to the action', () => {
    expect(MANAGER_ROWS).toHaveLength(22);
    expect(ACTION_ROWS).toHaveLength(6);

    for (const entry of KIT_ROWS) {
      const result = decodeRevert(revertData(entry, samplesFor(entry, 3)));

      expect(result.known && result.source).toBe(entry.source);
    }
  });

  it('decodes every integer argument as a bigint, including the extremes of its width', () => {
    for (const extreme of ['max', 'zero'] as const) {
      for (const entry of KIT_ROWS) {
        const samples = samplesFor(entry, 5);
        const fixed = entry.inputs.map((input, at) => {
          if (!input.type.startsWith('uint')) return samples[at] ?? 0n;

          return extreme === 'zero' ? 0n : (1n << BigInt(Number(input.type.slice('uint'.length)))) - 1n;
        });
        const result = decodeRevert(revertData(entry, fixed));

        expect(result.known).toBe(true);

        if (!result.known) continue;

        entry.inputs.forEach((input, at) => {
          if (input.type.startsWith('uint')) expect(result.args[input.name]).toBe(fixed[at]);
        });
      }
    }
  });

  it('reads NotConsumable\'s attempt state as the enum\'s integer', () => {
    const notConsumable = rowNamed('RecoveryAction_NotConsumable');

    const account: Hex = '0x1111111111111111111111111111111111111111';
    const hash: Hex = `0x${'ef'.repeat(32)}`;
    const result = decodeRevert(revertData(notConsumable, [account, 2n, 1_800_000_000n, hash]));

    expect(result).toMatchObject({ known: true, args: { account, state: 2n, consumableAfter: 1_800_000_000n, committedPayloadHash: hash } });
  });

  it('returns the bytes argument of MalformedHandover as lower-case hex, empty bytes included', () => {
    const malformed = rowNamed('RecoveryAction_MalformedHandover');

    expect(decodeRevert(revertData(malformed, ['0xABCDEF']))).toMatchObject({ args: { payload: '0xabcdef' } });
    expect(decodeRevert(revertData(malformed, ['0x']))).toMatchObject({ known: true, args: { payload: '0x' } });
  });
});

describe('decodeRevert names each error under the prefix its contract declares', () => {
  it('names every manager row PolicyManager_ and every action row RecoveryAction_', () => {
    for (const entry of MANAGER_ROWS) expect(decodeRevert(revertData(entry, samplesFor(entry, 6)))).toMatchObject({ name: entry.name });

    expect(MANAGER_ROWS.every((entry) => entry.name.startsWith('PolicyManager_'))).toBe(true);
    expect(ACTION_ROWS.every((entry) => entry.name.startsWith('RecoveryAction_'))).toBe(true);
  });

  it('decodes PolicyManager_NoSetup under its pinned selector 0x912e69d3 with both addresses checksummed', () => {
    const account: Hex = '0x52908400098527886e0f7030069857d2e4169ee7';
    const action: Hex = '0x8617e340b3d01fa5f11f306f4090fd50e238070d';
    const data: Hex = `0x912e69d3${'00'.repeat(12)}${account.slice(2)}${'00'.repeat(12)}${action.slice(2)}`;

    expect(decodeRevert(data)).toEqual({
      known: true,
      source: 'manager',
      name: 'PolicyManager_NoSetup',
      selector: '0x912e69d3',
      args: { account: '0x52908400098527886E0F7030069857D2E4169EE7', action: '0x8617E340B3D01FA5F11F306F4090FD50E238070D' },
    });
  });

  it.each([
    ['RecoveryAction_NotAKey', '0x63add869'],
    ['RecoveryAction_AlreadyPrivileged', '0xd2221b55'],
  ] as const)('decodes the action\'s %s under %s', (name, selector) => {
    // An address whose EIP-55 checksum is all lower case, so it comes back unchanged.
    const authority: Hex = '0xde709f2102306220921060314715629080e2fb77';
    const result = decodeRevert(`${selector}${'00'.repeat(12)}${authority.slice(2)}`);

    expect(result).toEqual({
      known: true,
      source: 'action',
      name,
      selector,
      args: { authority },
    });
  });

  it('decodes PolicyManager_ActionDoesNotServeAccount under 0xa1844eb2 from two address words, as the manager', () => {
    const account: Hex = '0x52908400098527886e0f7030069857d2e4169ee7';
    const action: Hex = '0x8617e340b3d01fa5f11f306f4090fd50e238070d';
    const data: Hex = `0xa1844eb2${'00'.repeat(12)}${account.slice(2)}${'00'.repeat(12)}${action.slice(2)}`;

    expect(decodeRevert(data)).toEqual({
      known: true,
      source: 'manager',
      name: 'PolicyManager_ActionDoesNotServeAccount',
      selector: '0xa1844eb2',
      args: { account: '0x52908400098527886E0F7030069857D2E4169EE7', action: '0x8617E340B3D01FA5F11F306F4090FD50E238070D' },
    });
  });

  it('decodes RecoveryAction_AccountNotServed under 0x3f6b40e3 from one address word, as the action', () => {
    const account: Hex = '0x52908400098527886e0f7030069857d2e4169ee7';

    expect(decodeRevert(`0x3f6b40e3${'00'.repeat(12)}${account.slice(2)}`)).toEqual({
      known: true,
      source: 'action',
      name: 'RecoveryAction_AccountNotServed',
      selector: '0x3f6b40e3',
      args: { account: '0x52908400098527886E0F7030069857D2E4169EE7' },
    });
  });

  it.each([
    ['PolicyManager_ActionDoesNotServeAccount', 'a word short', `0xa1844eb2${'00'.repeat(12)}${'11'.repeat(20)}`],
    ['PolicyManager_ActionDoesNotServeAccount', 'a dirty address word', `0xa1844eb2${'ff'.repeat(12)}${'11'.repeat(20)}${'00'.repeat(12)}${'22'.repeat(20)}`],
    ['RecoveryAction_AccountNotServed', 'no word', '0x3f6b40e3'],
    ['RecoveryAction_AccountNotServed', 'a dirty address word', `0x3f6b40e301${'00'.repeat(11)}${'11'.repeat(20)}`],
  ] as const)('leaves %s with %s unknown, its selector kept', (_name, _case, data) => {
    expect(decodeRevert(data as Hex)).toMatchObject({ known: false, selector: data.slice(0, 10) });
  });

  it('no longer names the retired ReservedAuthority(address) selector', () => {
    expect(decodeRevert(`0x58c9302f${'00'.repeat(12)}${'11'.repeat(20)}`)).toMatchObject({ known: false, selector: '0x58c9302f' });
  });
});

describe('decodeRevert names the language pair', () => {
  const errorString = (message: string): Hex =>
    `${ERROR_STRING_SELECTOR}${encodeAbiParameters([{ type: 'string' }], [message]).slice(2)}`;
  const panic = (code: bigint): Hex => `${PANIC_SELECTOR}${encodeAbiParameters([{ type: 'uint256' }], [code]).slice(2)}`;

  it('decodes Error(string) as a language error carrying its one message', () => {
    const result = decodeRevert(errorString('not allowed'));

    expect(result).toMatchObject({ known: true, source: 'language', name: 'Error', selector: ERROR_STRING_SELECTOR });
    expect(result.known && result.args).toEqual({ message: 'not allowed' });
  });

  it('decodes the arithmetic overflow Panic(uint256) code 0x11 as a bigint', () => {
    const result = decodeRevert(panic(0x11n));

    expect(result).toMatchObject({ known: true, source: 'language', name: 'Panic', selector: PANIC_SELECTOR });
    expect(result.known && result.args).toEqual({ reason: 0x11n });
  });

  it('decodes an empty Error(string) message', () => {
    const result = decodeRevert(errorString(''));

    expect(result.known && Object.values(result.args)).toEqual(['']);
  });
});
