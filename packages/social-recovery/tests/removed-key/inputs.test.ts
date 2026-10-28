import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, type PinnedBlock, type RemovedKeyInputs } from '../../src/index';
import { ACCOUNT, ACTION, BLOCK, committed, DESCRIPTOR, key, keySet, nodeFor, OTHER_ACTION, rig, type Rig } from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** A rig whose every read would answer, so a refusal is the only way nothing is read. */
const ready = (overrides: Partial<RemovedKeyInputs> = {}, codecOverride = codec): Rig => {
  const history = [committed({ block: 300 })];

  return rig(
    { notifications: { value: history }, authorities: keySet(key(0), key(2)), transactions: nodeFor(history), signer: { value: key(2) } },
    overrides,
    codecOverride,
  );
};

const refuses = async (inputs: unknown, block: unknown = BLOCK, error: typeof TypeError | typeof RangeError = TypeError): Promise<void> => {
  await expect(async () => inferRemovedKey(inputs as RemovedKeyInputs, block as PinnedBlock)).rejects.toThrow(error);
};

const BAD_ADDRESSES: readonly (readonly [string, unknown])[] = [
  ['mixed case with a bad checksum', `0x${key(0).slice(2, 4).toLowerCase()}${key(0).slice(4, 6).toUpperCase()}${key(0).slice(6)}`],
  ['not hex', '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
  ['nineteen bytes', `0x${'ab'.repeat(19)}`],
  ['no 0x prefix', 'ab'.repeat(20)],
  ['a number', 42],
  ['null', null],
];

describe('inputs refused before any read: a TypeError for a wrong type, a RangeError for an out-of-range number', () => {
  it('the bad-checksum spelling really is mixed case and not EIP-55', () => {
    const spelling = BAD_ADDRESSES[0]?.[1] as string;

    expect(spelling.toLowerCase()).toBe(key(0).toLowerCase());
    expect(spelling).not.toBe(key(0));
    expect(spelling).not.toBe(spelling.toLowerCase());
  });

  it.each([['null', null], ['undefined', undefined], ['a number', 7], ['a string', 'inputs']])('inputs that are %s', async (_label, value) => {
    await refuses(value);
  });

  describe.each(['supplied', 'account', 'actionAddress'] as const)('%s', (member) => {
    it.each(BAD_ADDRESSES)('%s', async (_label, value) => {
      const { inputs, reads } = ready({ [member]: value } as Partial<RemovedKeyInputs>);

      await refuses(inputs);
      expect(reads).toEqual([]);
    });
  });

  it.each<readonly [string, unknown, typeof TypeError | typeof RangeError]>([
    ['null', null, TypeError],
    ['a number', 500, TypeError],
    ['a negative number', { number: -1, hash: BLOCK.hash }, RangeError],
    ['a fractional number', { number: 1.5, hash: BLOCK.hash }, TypeError],
    ['an unsafe number', { number: 2 ** 53, hash: BLOCK.hash }, RangeError],
    ['a string number', { number: '500', hash: BLOCK.hash }, TypeError],
    ['no hash', { number: 500 }, TypeError],
    ['a short hash', { number: 500, hash: '0x1234' }, TypeError],
    ['a non-hex hash', { number: 500, hash: `0x${'zz'.repeat(32)}` }, TypeError],
  ])('a block that is %s', async (_label, block, error) => {
    const { inputs, reads } = ready();

    await refuses(inputs, block, error);
    expect(reads).toEqual([]);
  });

  it.each<readonly [string, unknown, typeof TypeError | typeof RangeError]>([
    ['negative', -1, RangeError],
    ['fractional', 100.5, TypeError],
    ['NaN', Number.NaN, TypeError],
    ['unsafe', 2 ** 53, RangeError],
    ['a string', '100', TypeError],
    ['missing', undefined, TypeError],
  ])('a deployedAt that is %s', async (_label, deployedAt, error) => {
    const { inputs, reads } = ready({ descriptor: { ...DESCRIPTOR, deployedAt: deployedAt as number } });

    await refuses(inputs, BLOCK, error);
    expect(reads).toEqual([]);
  });

  it('a codec that does not serve the bound action', async () => {
    const { inputs, reads } = ready({}, new AmbireActionCodec([OTHER_ACTION]));

    await refuses(inputs);
    expect(reads).toEqual([]);
  });

});

describe('inputs accepted', () => {
  const spellings = (address: string): readonly (readonly [string, `0x${string}`])[] => [
    ['all lower-case', address.toLowerCase() as `0x${string}`],
    ['all upper-case', `0x${address.slice(2).toUpperCase()}`],
    ['EIP-55', address as `0x${string}`],
  ];

  it.each(spellings(ACCOUNT))('an account spelled %s', async (_label, account) => {
    const { inputs } = ready({ account });

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
  });

  it.each(spellings(ACTION))('an action address spelled %s, the codec serving it in another spelling', async (_label, actionAddress) => {
    const { inputs } = ready({ actionAddress });

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
  });

  it.each(spellings(key(0)))('a supplied address spelled %s, returned checksummed', async (_label, supplied) => {
    const { inputs } = ready({ supplied });

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(0));
  });

  it('an absent supplied address written as undefined', async () => {
    const { inputs } = ready({ supplied: undefined });

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(key(2));
  });

  it('a deployedAt of zero and a block of zero', async () => {
    const { inputs, reads } = ready({ descriptor: { ...DESCRIPTOR, deployedAt: 0 } });

    await expect(inferRemovedKey(inputs, { number: 0, hash: BLOCK.hash })).resolves.toBe(key(2));
    expect(reads[0]).toMatchObject({ kind: 'fetch', range: { from: 0, to: 0 } });
  });

  it('a block whose hash is upper-case hex', async () => {
    const { inputs } = ready();

    await expect(inferRemovedKey(inputs, { number: BLOCK.number, hash: `0x${BLOCK.hash.slice(2).toUpperCase()}` })).resolves.toBe(key(2));
  });
});
