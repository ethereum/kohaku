import { encodeFunctionData, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import * as entry from '../../src/index';
import { RECOVERY_ACTION_MANAGER_ABI, RECOVERY_ACTION_VIEWS_ABI, type Address, type BlockTag, type Hex } from '../../src/index';
import * as actionModule from '../../src/recovery-action';
import { actionManagerAt } from '../../src/recovery-action/manager-read';
import { ACTION, ZERO, selectorOf, word } from './fixtures';
import { providerDouble, type CallAnswer } from './provider-double';

const MANAGER_SELECTOR = selectorOf('MANAGER()');
const LETTERED: Address = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const CLEAN: Hex = `0x${word(LETTERED)}`;

const answering = (answer: CallAnswer) => providerDouble({ [MANAGER_SELECTOR]: answer });

describe('RECOVERY_ACTION_MANAGER_ABI', () => {
  it('declares the one view MANAGER(), returning address _manager, under 0x1b2df850', () => {
    expect(RECOVERY_ACTION_MANAGER_ABI).toEqual([
      { type: 'function', name: 'MANAGER', stateMutability: 'view', inputs: [], outputs: [{ name: '_manager', type: 'address' }] },
    ]);
    expect(MANAGER_SELECTOR).toBe('0x1b2df850');
    expect(encodeFunctionData({ abi: RECOVERY_ACTION_MANAGER_ABI })).toBe(MANAGER_SELECTOR);
  });

  it('leaves the views fragment without MANAGER()', () => {
    expect(RECOVERY_ACTION_VIEWS_ABI.map((item) => item.name)).not.toContain('MANAGER');
  });
});

describe('actionManagerAt', () => {
  it('is no export of the action module or the core entry', () => {
    expect('actionManagerAt' in actionModule).toBe(false);
    expect('actionManagerAt' in entry).toBe(false);
  });

  it.each<BlockTag>(['finalized', 'latest', 19_283_746])('makes one MANAGER() call to the action from the zero address at %s', async (at) => {
    const double = answering({ returns: CLEAN });

    await actionManagerAt(double.provider, ACTION, at);

    expect(double.calls).toEqual([{ to: ACTION, data: MANAGER_SELECTOR, from: ZERO, block: at }]);
  });

  it('answers a clean word with the address it holds, checksummed', async () => {
    expect(await actionManagerAt(answering({ returns: CLEAN }).provider, ACTION, 'latest')).toEqual({ answered: true, value: getAddress(LETTERED) });
  });

  it.each<[string, CallAnswer]>([
    ['a revert without data', { rejects: { data: '0x' } }],
    ['a revert carrying Error(string)', { rejects: Object.assign(new Error('execution reverted'), { data: '0x08c379a0' }) }],
    ['no bytes, as an address without code answers', { returns: '0x' }],
    ['a short word', { returns: CLEAN.slice(0, 64) as Hex }],
    ['a word with dirty top bytes', { returns: `0x${'ff'.repeat(12)}${LETTERED.slice(2)}` }],
    ['one trailing byte after the word', { returns: `${CLEAN}00` }],
    ['a second word after the first', { returns: `${CLEAN}${word('0')}` }],
  ])('reads %s as unanswered', async (_name, answer) => {
    expect(await actionManagerAt(answering(answer).provider, ACTION, 'latest')).toEqual({ answered: false });
  });

  it.each<[string, unknown]>([
    ['a failed transport', new Error('connect ECONNREFUSED')],
    ['an object without data', { message: 'reverted' }],
    ['data that is not hex', { data: 42 }],
  ])('rejects with %s as itself', async (_name, thrown) => {
    await expect(actionManagerAt(answering({ rejects: thrown }).provider, ACTION, 'latest')).rejects.toBe(thrown);
  });
});
