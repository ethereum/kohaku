import { describe, expect, it } from 'vitest';
import {
  AmbireRecoveryAction,
  FORMATS_ZERO_ADDRESS,
  RECOVERY_ACTION_READ_FROM,
  RECOVERY_ACTION_ZERO_ADDRESS,
  type Address,
  type BlockHeader,
  type IActionCodec,
} from '../../src/index';
import { ACCOUNT, ACTION, BLOCK_TAGS, boolWord, DESCRIPTOR, partOver, SELECTORS } from './fixtures';
import { providerDouble } from './provider-double';

const ZERO_LITERAL = '0x0000000000000000000000000000000000000000';

/** A hand-made codec serving the given entries, so a malformed entry reaches the part's constructor. */
const codecServing = (actions: readonly unknown[]): IActionCodec => ({
  actions: actions as readonly Address[],
  encode: () => '0x',
  decode: () => ({ newAuthority: ACTION }),
});

const construct = (actions: readonly unknown[]) => () =>
  new AmbireRecoveryAction(providerDouble().provider, DESCRIPTOR, ACCOUNT, ACTION, codecServing(actions), BLOCK_TAGS);

describe("the codec's served actions at construction", () => {
  it.each([
    ['a short address', ['0x1234', ACTION], 0],
    ['a number', [ACTION, 7], 1],
    ['a bad checksum', [ACTION, '0x2222222222222222222222222222222222222222', '0xAbcdefabcdefabcdefabcdefabcdefabcdefabcd'], 2],
    ['null', [null, ACTION], 0],
  ] as const)('throws a TypeError naming the entry for %s', (_label, actions, index) => {
    expect(construct(actions)).toThrow(TypeError);
    expect(construct(actions)).toThrow(`codec.actions[${index}]`);
  });

  it('accepts entries in lower case, upper case or checksummed', () => {
    expect(construct([`0x${'AB'.repeat(20)}`, ACTION.toUpperCase().replace('0X', '0x')])).not.toThrow();
  });
});

describe('the zero address', () => {
  it('is one literal under every name', () => {
    expect(FORMATS_ZERO_ADDRESS).toBe(ZERO_LITERAL);
    expect(RECOVERY_ACTION_ZERO_ADDRESS).toBe(ZERO_LITERAL);
    expect(RECOVERY_ACTION_READ_FROM).toBe(ZERO_LITERAL);
  });

  it('is the address every view is read from', async () => {
    const double = providerDouble({ [SELECTORS.isAuthorized]: { returns: boolWord(true) } });

    await partOver(double.provider).isAuthorized();
    expect(double.calls.map((seen) => seen.from)).toEqual([ZERO_LITERAL]);
  });
});

describe('the kit slot and binding', () => {
  it('give byte-identical prepares on every call, each costing one block read and no call', async () => {
    const double = providerDouble();
    const part = partOver(double.provider);
    const first = await part.armingCall();
    const second = await part.armingCall();
    const firstDisarm = await part.disarmingCall();
    const secondDisarm = await part.disarmingCall();

    expect(second.data).toBe(first.data);
    expect(secondDisarm.data).toBe(firstDisarm.data);
    expect(firstDisarm.data.slice(0, 74)).toBe(first.data.slice(0, 74));
    expect(double.blockTags).toHaveLength(4);
    expect(double.calls).toEqual([]);
    expect(double.codeReads).toBe(0);
  });
});

describe('a malformed header from the provider', () => {
  it.each([
    ['a negative number', { number: -1, timestamp: 0, hash: `0x${'aa'.repeat(32)}` }, RangeError, /^block header\.number /],
    ['a short hash', { number: 1, timestamp: 0, hash: '0xaa' }, TypeError, /^block header\.hash /],
  ] as const)('is refused (%s) with the field named', async (_label, header, kind, message) => {
    const part = partOver(providerDouble({}, header as BlockHeader).provider);

    await expect(part.disarmingCall()).rejects.toThrow(kind);
    await expect(part.disarmingCall()).rejects.toThrow(message);
  });
});
