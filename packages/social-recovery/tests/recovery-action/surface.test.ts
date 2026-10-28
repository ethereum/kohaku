import { encodeFunctionData } from 'viem';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as entry from '../../src/index';
import type { IActionCodec, IRecoveryActionArming, IRecoveryActionInteractor, PinnedBlock, PreparedCall } from '../../src/index';
import { ACCOUNT, ACTION, partOver, SELECTORS, word } from './fixtures';
import { providerDouble } from './provider-double';

describe('the core entry', () => {
  it('exports the action part, its codec, the interface id and the revert guard', () => {
    expect(typeof entry.AmbireRecoveryAction).toBe('function');
    expect(typeof entry.AmbireActionCodec).toBe('function');
    expect(entry.POLICY_ACTION_INTERFACE_ID).toBe('0x59cd148e');
    expect(typeof entry.isProviderRevert).toBe('function');
  });

  it("exports the account's setAddrPrivilege fragment, encoding under 0x0d5828d4", () => {
    const data = encodeFunctionData({
      abi: entry.RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI,
      functionName: 'setAddrPrivilege',
      args: [ACCOUNT, `0x${'11'.repeat(32)}`],
    });

    expect(data).toBe(`0x0d5828d4${word(ACCOUNT)}${'11'.repeat(32)}`);
  });
});

describe('the arming seam', () => {
  it('keeps armingCall off the interactor interface and disarmingCall on it', () => {
    expectTypeOf<IRecoveryActionInteractor>().not.toHaveProperty('armingCall');
    expectTypeOf<IRecoveryActionInteractor>().toHaveProperty('disarmingCall').toEqualTypeOf<(block?: PinnedBlock) => Promise<PreparedCall>>();
    expectTypeOf<IRecoveryActionArming>().toHaveProperty('armingCall').toEqualTypeOf<(block?: PinnedBlock) => Promise<PreparedCall>>();
  });

  it('hides armingCall from a value typed as the interactor', () => {
    const interactor: IRecoveryActionInteractor = partOver(providerDouble().provider);

    // @ts-expect-error armingCall is reachable through the arming interface alone
    expect(typeof interactor.armingCall).toBe('function');
  });

  it('implements both interfaces and the codec interface', () => {
    expectTypeOf<entry.AmbireRecoveryAction>().toMatchTypeOf<IRecoveryActionInteractor & IRecoveryActionArming>();
    expectTypeOf<entry.AmbireActionCodec>().toMatchTypeOf<IActionCodec>();
  });
});

describe('the members of the action part', () => {
  it('take no account: each takes at most the key or candidate, then an optional block', () => {
    expectTypeOf<entry.AmbireRecoveryAction['supportsAccount']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['isAuthorized']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['isAuthority']>().parameters.toEqualTypeOf<[key: entry.Address, block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['holdsAnyPrivilege']>().parameters.toEqualTypeOf<[candidate: entry.Address, block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['actionInfo']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['armingCall']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['disarmingCall']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
    expectTypeOf<entry.AmbireRecoveryAction['prepareSetAddrPrivilege']>().parameters.toEqualTypeOf<[value: entry.Hex, block?: PinnedBlock]>();
    expectTypeOf<IRecoveryActionInteractor['isAuthority']>().parameters.toEqualTypeOf<[key: entry.Address, block?: PinnedBlock]>();
    expectTypeOf<IRecoveryActionInteractor['actionInfo']>().parameters.toEqualTypeOf<[block?: PinnedBlock]>();
  });

  it('prepare no spend: no executeHandover or validateSig member', () => {
    expectTypeOf<entry.AmbireRecoveryAction>().not.toHaveProperty('prepareExecuteHandover');
    expectTypeOf<entry.AmbireRecoveryAction>().not.toHaveProperty('executeHandover');
    expectTypeOf<entry.AmbireRecoveryAction>().not.toHaveProperty('validateSig');

    const members = Object.getOwnPropertyNames(entry.AmbireRecoveryAction.prototype);

    expect(members.filter((member) => /handover|validatesig/i.test(member))).toEqual([]);
  });

  it('public methods are the interfaces members plus prepareSetAddrPrivilege', () => {
    const part = partOver(providerDouble().provider);
    const callable = Object.getOwnPropertyNames(entry.AmbireRecoveryAction.prototype).filter(
      (member) => member !== 'constructor' && typeof (part as unknown as Record<string, unknown>)[member] === 'function',
    );

    expect(callable).toEqual(
      expect.arrayContaining([
        'supportsAccount',
        'isAuthority',
        'isAuthorized',
        'holdsAnyPrivilege',
        'actionInfo',
        'disarmingCall',
        'armingCall',
        'prepareSetAddrPrivilege',
      ]),
    );
  });

  it('never emits executeHandover calldata from any member', async () => {
    const double = providerDouble();
    const part = partOver(double.provider);
    const prepared = [await part.armingCall(), await part.disarmingCall()];

    expect(prepared.map((call) => call.data.slice(0, 10))).not.toContain(SELECTORS.executeHandover);
    expect(prepared.map((call) => call.target.toLowerCase())).not.toContain(ACTION);
  });
});
