import { describe, expect, it } from 'vitest';
import { type Hex, type PreparedCall } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { ACCOUNT, ACCOUNT_CHECKSUMMED, ACTION, BLOCK_TAGS, OTHER_ACTION, partOver, SELECTORS, selectorOf, SIGNATURES, word, ZERO_WORD } from './fixtures';
import { HEADER, providerDouble } from './provider-double';

const normal = readVector('ambire-kit-slot.json').vectors.find((row) => row['id'] === 'normal');

if (normal === undefined) throw new Error('ambire-kit-slot has no normal row');

const expected = normal.expected as { readonly slot: string; readonly binding: string };
const vectorAction = normal.input['action'];

const shape = (data: Hex): PreparedCall => ({
  kind: 'call',
  target: ACCOUNT_CHECKSUMMED,
  value: 0n,
  data,
  sender: 'account',
  block: { number: HEADER.number, hash: HEADER.hash },
});

describe('setAddrPrivilege', () => {
  it('has the selector 0x0d5828d4', () => {
    expect(selectorOf(SIGNATURES.setAddrPrivilege)).toBe('0x0d5828d4');
  });
});

describe('armingCall', () => {
  it('replays the blessed kit-slot row', () => {
    expect(vectorAction).toBe(ACTION);
  });

  it("writes the action's binding under its kit slot through the account's own setAddrPrivilege", async () => {
    const call = await partOver(providerDouble().provider).armingCall();

    expect(call).toStrictEqual(shape(`0x0d5828d4${word(expected.slot)}${word(expected.binding)}`));
  });

  it('resolves the read tag once, makes no call and reads no code', async () => {
    const double = providerDouble();

    await partOver(double.provider).armingCall();
    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls).toEqual([]);
    expect(double.codeReads).toBe(0);
  });

  it('follows the bound action', async () => {
    const arming = await partOver(providerDouble().provider, ACCOUNT, OTHER_ACTION).armingCall();

    expect(arming.data).not.toBe(shape(`0x0d5828d4${word(expected.slot)}${word(expected.binding)}`).data);
    expect(arming.data.slice(0, 10)).toBe(SELECTORS.setAddrPrivilege);
  });
});

describe('disarmingCall', () => {
  it('writes zero under the same kit slot', async () => {
    const call = await partOver(providerDouble().provider).disarmingCall();

    expect(call).toStrictEqual(shape(`0x0d5828d4${word(expected.slot)}${ZERO_WORD.slice(2)}`));
  });

  it('resolves the read tag once, makes no call and reads no code', async () => {
    const double = providerDouble();

    await partOver(double.provider).disarmingCall();
    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls).toEqual([]);
    expect(double.codeReads).toBe(0);
  });

  it('targets the account checksummed whatever its spelling', async () => {
    const upper = await partOver(providerDouble().provider, `0x${ACCOUNT.slice(2).toUpperCase()}`).disarmingCall();

    expect(upper.target).toBe(ACCOUNT_CHECKSUMMED);
  });
});

describe('prepareSetAddrPrivilege', () => {
  it('pins the block the read tag resolved to, its hash lower-cased', async () => {
    const upper = { ...HEADER, hash: `0x${HEADER.hash.slice(2).toUpperCase()}` as Hex };
    const call = await partOver(providerDouble({}, upper).provider).disarmingCall();

    expect(call.block).toEqual({ number: HEADER.number, hash: HEADER.hash });
  });

  it('writes any 32-byte value under the kit slot, lower-cased', async () => {
    const value: Hex = `0x${'AB'.repeat(32)}`;
    const call = await partOver(providerDouble().provider).prepareSetAddrPrivilege(value);

    expect(call).toStrictEqual(shape(`0x0d5828d4${word(expected.slot)}${'ab'.repeat(32)}`));
  });

  it.each([
    ['31 bytes', `0x${'00'.repeat(31)}`],
    ['33 bytes', `0x${'00'.repeat(33)}`],
    ['no prefix', '00'.repeat(32)],
    ['a number', 0],
  ])('refuses a value of %s', async (_label, value) => {
    const part = partOver(providerDouble().provider);

    await expect((async () => part.prepareSetAddrPrivilege(value as Hex))()).rejects.toThrow();
  });

  it('is what armingCall and disarmingCall are built over', async () => {
    const part = partOver(providerDouble().provider);

    expect(await part.armingCall()).toStrictEqual(await part.prepareSetAddrPrivilege(expected.binding as Hex));
    expect(await part.disarmingCall()).toStrictEqual(await part.prepareSetAddrPrivilege(ZERO_WORD));
  });
});
