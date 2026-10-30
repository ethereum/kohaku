import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, AmbireRecoveryAction, type Address, type Hex } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  BLOCK_TAGS,
  boolWord,
  CANDIDATE,
  DESCRIPTOR,
  KEY,
  OTHER_ACTION,
  partOver,
  SELECTORS,
  word,
} from './fixtures';
import { HEADER, providerDouble, type CallAnswer } from './provider-double';

type View = 'supportsAccount' | 'isAuthority' | 'isAuthorized' | 'holdsAnyPrivilege';

/** Each view, how to call it on the part, and the calldata the action contract expects over the bound account. */
const VIEWS: readonly (readonly [View, (part: AmbireRecoveryAction) => Promise<boolean>, Hex])[] = [
  ['supportsAccount', (part) => part.supportsAccount(), `${SELECTORS.supportsAccount}${word(ACCOUNT)}`],
  ['isAuthority', (part) => part.isAuthority(KEY), `${SELECTORS.isAuthority}${word(ACCOUNT)}${word(KEY)}`],
  ['isAuthorized', (part) => part.isAuthorized(), `${SELECTORS.isAuthorized}${word(ACCOUNT)}`],
  ['holdsAnyPrivilege', (part) => part.holdsAnyPrivilege(CANDIDATE), `${SELECTORS.holdsAnyPrivilege}${word(ACCOUNT)}${word(CANDIDATE)}`],
];

const answering = (view: View, answer: CallAnswer) => providerDouble({ [SELECTORS[view]]: answer });

describe('the selectors the views call', () => {
  it('are the hand-written signatures recomputed', () => {
    expect(SELECTORS).toMatchObject({
      supportsAccount: '0x945c7a28',
      isAuthority: '0x60f18fd2',
      isAuthorized: '0xfe9fbb80',
      holdsAnyPrivilege: '0x90d942f8',
      supportsInterface: '0x01ffc9a7',
      name: '0x06fdde03',
      version: '0x54fd4d50',
    });
  });
});

describe.each(VIEWS)('%s', (view, read, calldata) => {
  it.each([true, false])('answers %s from one call to the bound action over the bound account', async (value) => {
    const double = answering(view, { returns: boolWord(value) });

    await expect(read(partOver(double.provider))).resolves.toBe(value);
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0]?.to.toLowerCase()).toBe(ACTION);
    expect(double.calls[0]?.data.toLowerCase()).toBe(calldata);
  });

  it('resolves the read tag once and calls at the block number it returned', async () => {
    const double = answering(view, { returns: boolWord(true) });

    await read(partOver(double.provider));
    expect(double.blockTags).toEqual([BLOCK_TAGS.read]);
    expect(double.calls[0]?.block).toBe(HEADER.number);
  });

  it('reads no code, no logs and no chain id', async () => {
    const double = answering(view, { returns: boolWord(true) });

    await read(partOver(double.provider));
    expect([double.codeReads, double.logReads, double.chainIdReads]).toEqual([0, 0, 0]);
  });

  it('addresses the action, never the account', async () => {
    const double = answering(view, { returns: boolWord(true) });

    await read(partOver(double.provider));
    expect(double.calls.map((seen) => seen.to.toLowerCase())).not.toContain(ACCOUNT);
    expect(double.calls.map((seen) => seen.data.slice(0, 10))).not.toContain(SELECTORS.privileges);
  });

  it.each([
    ['2', `0x${word('2')}`],
    ['a high bit', `0x8${'0'.repeat(62)}1`],
    ['all ones', `0x${'f'.repeat(64)}`],
  ])('throws on a word other than 0 or 1 (%s)', async (_label, returns) => {
    await expect(read(partOver(answering(view, { returns: returns as Hex }).provider))).rejects.toThrow();
  });

  it.each([
    ['empty', '0x'],
    ['31 bytes', `0x${word('1').slice(2)}`],
  ])('throws on a short return (%s)', async (_label, returns) => {
    await expect(read(partOver(answering(view, { returns: returns as Hex }).provider))).rejects.toThrow();
  });

  it('rethrows a revert as the provider raised it', async () => {
    const revert = { data: '0x08c379a0' as Hex };

    await expect(read(partOver(answering(view, { rejects: revert }).provider))).rejects.toBe(revert);
  });

  it('rethrows a transport failure as the provider raised it', async () => {
    const failure = new Error('socket closed');

    await expect(read(partOver(answering(view, { rejects: failure }).provider))).rejects.toBe(failure);
  });
});

describe('the bound account and action', () => {
  it('encodes the account given in upper case the same as in lower case', async () => {
    const double = answering('isAuthorized', { returns: boolWord(true) });

    await partOver(double.provider, `0x${ACCOUNT.slice(2).toUpperCase()}` as Address).isAuthorized();
    expect(double.calls[0]?.data.toLowerCase()).toBe(`${SELECTORS.isAuthorized}${word(ACCOUNT)}`);
  });

  it('reads the action given to the constructor, not the descriptor action', async () => {
    const double = answering('isAuthorized', { returns: boolWord(true) });

    await partOver(double.provider, ACCOUNT, OTHER_ACTION).isAuthorized();
    expect(double.calls[0]?.to.toLowerCase()).toBe(OTHER_ACTION);
    await partOver(double.provider, ACCOUNT, ACTION).isAuthorized();
    expect(double.calls[1]?.to.toLowerCase()).toBe(ACTION);
  });

  it('throws when the action is not one the codec serves', () => {
    const { provider } = providerDouble();
    const codec = new AmbireActionCodec([OTHER_ACTION]);

    expect(() => new AmbireRecoveryAction(provider, DESCRIPTOR, ACCOUNT, ACTION, codec, BLOCK_TAGS)).toThrow();
  });

  it('accepts the action in another spelling of an address the codec serves', () => {
    const { provider } = providerDouble();
    const codec = new AmbireActionCodec([getAddress(`0x${'ab'.repeat(20)}`)]);

    expect(() => new AmbireRecoveryAction(provider, DESCRIPTOR, ACCOUNT, `0x${'ab'.repeat(20)}`, codec, BLOCK_TAGS)).not.toThrow();
  });

  it('refuses a malformed account', () => {
    const { provider } = providerDouble();
    const codec = new AmbireActionCodec([ACTION]);

    expect(() => new AmbireRecoveryAction(provider, DESCRIPTOR, '0x1234', ACTION, codec, BLOCK_TAGS)).toThrow();
  });

  it('refuses a malformed key or candidate before any read', async () => {
    const double = providerDouble({ [SELECTORS.isAuthority]: { returns: boolWord(true) }, [SELECTORS.holdsAnyPrivilege]: { returns: boolWord(true) } });
    const part = partOver(double.provider);

    await expect((async () => part.isAuthority('0x1234'))()).rejects.toThrow();
    await expect((async () => part.holdsAnyPrivilege('0x1234'))()).rejects.toThrow();
    expect(double.calls).toEqual([]);
  });
});
