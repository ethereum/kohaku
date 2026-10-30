import { describe, expect, it } from 'vitest';
import * as entry from '../../src/index';
import type { IMethodModuleReads, IPolicyManagerInteractor } from '../../src/index';
import { selectorOf } from '../helpers/keccak';
import { always } from './double';
import { answeringAll } from './members';
import { ACCOUNT, ACTION, METHOD, POLICY_METHOD_ID_LITERAL, TRUE_WORD, partFor } from './fixtures';

/** The five functions `IPolicyMethod` declares, written by hand. */
const POLICY_METHOD_FUNCTIONS = ['verify(bytes,bytes32,bytes)', 'trustedParties()', 'supportsInterface(bytes4)', 'name()', 'version()'];

describe('POLICY_METHOD_INTERFACE_ID', () => {
  it('is the XOR of the IPolicyMethod selectors by the independent hash, pinned as 0xf057a368', () => {
    const xor = POLICY_METHOD_FUNCTIONS.map((signature) => Number.parseInt(selectorOf(signature).slice(2), 16)).reduce((a, b) => (a ^ b) >>> 0, 0);

    expect(`0x${xor.toString(16).padStart(8, '0')}`).toBe(POLICY_METHOD_ID_LITERAL);
    expect(entry.POLICY_METHOD_INTERFACE_ID).toBe('0xf057a368');
  });

  it('differs from the ERC-165 id itself and from the id without supportsInterface', () => {
    expect(entry.POLICY_METHOD_INTERFACE_ID).not.toBe('0x01ffc9a7');
    expect(entry.POLICY_METHOD_INTERFACE_ID).not.toBe('0xf1a86acf');
  });
});

describe('the public surface', () => {
  it('exports PolicyManager, POLICY_METHOD_INTERFACE_ID and isProviderRevert from the core entry', () => {
    expect(typeof entry.PolicyManager).toBe('function');
    expect(typeof entry.isProviderRevert).toBe('function');
    expect(typeof entry.POLICY_METHOD_INTERFACE_ID).toBe('string');
  });

  it('exports the unanswered module read as POLICY_MANAGER_UNANSWERED', () => {
    expect(entry.POLICY_MANAGER_UNANSWERED).toEqual({ answered: false });
  });

  it('freezes POLICY_MANAGER_UNANSWERED, so no caller can turn a failed read into an answer', () => {
    const shared = entry.POLICY_MANAGER_UNANSWERED as { answered: boolean };

    expect(Object.isFrozen(shared)).toBe(true);
    expect(() => {
      shared.answered = true;
    }).toThrow(TypeError);
    expect(entry.POLICY_MANAGER_UNANSWERED).toEqual({ answered: false });
  });

  it('hands out the frozen record itself for a module read that answered nothing', async () => {
    const result = await partFor(always({ rejects: new Error('down') })).paused(METHOD);

    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toEqual({ answered: false });
  });

  it('hands one instance out through both interfaces', () => {
    const part = partFor(always({ returns: TRUE_WORD }));
    const interactor: IPolicyManagerInteractor = part;
    const reads: IMethodModuleReads = part;

    expect(reads).toBe(interactor);
  });
});

describe('what the part reads, over every member', () => {
  it('makes one call per manager view and per module view it answers, one block read per member, and never code, logs or verify', async () => {
    const provider = answeringAll();
    const part = partFor(provider);
    const expectedCalls: [() => Promise<unknown>, number][] = [
      [() => part.stateOf(), 1],
      [() => part.eip712Domain(), 1],
      [() => part.name(), 1],
      [() => part.version(), 1],
      [() => part.supportsInterface('0x01ffc9a7'), 1],
      [() => part.paused(METHOD), 1],
      [() => part.trustedParties(METHOD), 1],
      [() => part.moduleInfo(METHOD), 3],
      [() => part.prepareCommitSetup(ACTION, `0x${'11'.repeat(32)}`, 1n, '0x', '0x'), 0],
      [() => part.prepareClearSetup(ACTION, 1n), 0],
      [() => part.prepareCancelByOwner(ACTION, 1n), 0],
      [() => part.prepareCancelByVeto(ACCOUNT, ACTION, 1n, METHOD), 0],
    ];

    for (const [member, calls] of expectedCalls) {
      const before = provider.calls.length;
      const blocksBefore = provider.blockTags.length;

      await member();

      expect(provider.calls.length - before).toBe(calls);
      expect(provider.blockTags.length - blocksBefore).toBe(1);
    }

    expect(provider.selectors()).not.toContain(selectorOf('verify(bytes,bytes32,bytes)'));
    expect(provider.codeReads).toBe(0);
    expect(provider.logReads).toBe(0);
    expect(provider.chainIdReads).toBe(0);
  });
});
