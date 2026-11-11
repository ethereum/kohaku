import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, validateSetup, type MethodDescriptionReads, type SetupValidationContext } from '../../src/index';
import { DRAFT as VALIDATION_DRAFT, SETUP_CONTEXT } from '../validation/fixtures';
import { CANDIDATE_A, CANDIDATE_B, CONFIGURATION, CONTEXT, DESCRIPTOR, DRAFT, ZKPASSPORT, withMethod } from './setup-fixtures';

const LETTERED = '0xabcdef0123456789abcdef0123456789abcdef02';

describe('describeSetup refuses a candidate key answered twice', () => {
  it('throws a TypeError naming the repeated index for one key in two spellings', () => {
    const context = {
      ...CONTEXT,
      configuration: { ...CONFIGURATION, candidateKeys: [LETTERED] as const },
      candidateKeys: [
        { key: LETTERED, isAuthority: true },
        { key: getAddress(LETTERED), isAuthority: false },
      ],
    } as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(/candidateKeys\[1\]/);
  });

  it('accepts distinct keys', () => {
    expect(describeSetup(DRAFT, CONTEXT).candidateKeys.map((entry) => entry.key)).toEqual([CANDIDATE_A, CANDIDATE_B]);
  });
});

describe('describeSetup refuses sparse context lists, naming the hole', () => {
  it('throws a TypeError naming context.methods[1] for a hole in the method reads', () => {
    const [first, , ...rest] = CONTEXT.methods;
    // eslint-disable-next-line no-sparse-arrays
    const context = { ...CONTEXT, methods: [first, , ...rest] } as unknown as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(/^context\.methods\[1\] /);
  });

  it('throws a TypeError naming context.methods[0] for a one-slot empty list', () => {
    const context = { ...CONTEXT, methods: new Array<unknown>(1) } as unknown as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(/^context\.methods\[0\] /);
  });

  it('throws a TypeError naming context.candidateKeys[1] for a hole in the candidate keys', () => {
    const [first, second] = CONTEXT.candidateKeys;
    // eslint-disable-next-line no-sparse-arrays
    const context = { ...CONTEXT, candidateKeys: [first, , second] } as unknown as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(/^context\.candidateKeys\[1\] /);
  });
});

describe('describeSetup refuses a tier outside the closed set', () => {
  it('throws a TypeError naming the method\'s tier for tertiary', () => {
    const context = withMethod(ZKPASSPORT, { tier: 'tertiary' } as unknown as Partial<MethodDescriptionReads>);
    const index = CONTEXT.methods.findIndex((entry) => entry.module === ZKPASSPORT);

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(new RegExp(`context\\.methods\\[${index}\\]\\.tier`));
  });

  it.each(['primary', 'secondary'] as const)('accepts %s', (tier) => {
    const standing = describeSetup(DRAFT, withMethod(ZKPASSPORT, { tier })).methodStanding.find((entry) => entry.method === ZKPASSPORT);

    expect(standing?.tier).toBe(tier);
  });
});

describe('describeSetup refuses a malformed action read, naming the path', () => {
  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a string supportsAccount', { supportsAccount: 'yes' }, /context\.action\.supportsAccount/],
    ['an undefined supportsAccount', { supportsAccount: undefined }, /context\.action\.supportsAccount/],
    ['a numeric accountHoldsCode', { accountHoldsCode: 1 }, /context\.action\.accountHoldsCode/],
    ['a null accountHoldsCode', { accountHoldsCode: null }, /context\.action\.accountHoldsCode/],
    ['a missing actionInfo', { actionInfo: undefined }, /context\.action\.actionInfo/],
    ['a string actionInfo', { actionInfo: 'ambire' }, /context\.action\.actionInfo/],
    ['an actionInfo whose answered is a string', { actionInfo: { answered: 'yes' } }, /context\.action\.actionInfo\.answered/],
    ['an answered actionInfo without a value', { actionInfo: { answered: true } }, /context\.action\.actionInfo\.value/],
    ['a missing manager', { manager: undefined }, /context\.action\.manager/],
    ['a bare address as the manager', { manager: '0x8000000000000000000000000000000000000001' }, /context\.action\.manager/],
    ['a manager whose answered is a string', { manager: { answered: 'yes' } }, /context\.action\.manager\.answered/],
    ['an answered manager whose value is no address', { manager: { answered: true, value: 'nope' } }, /context\.action\.manager/],
    ['a string fallbackHandlerEntry', { fallbackHandlerEntry: '0x6969' }, /context\.action\.fallbackHandlerEntry/],
    ['a null fallbackHandlerEntry', { fallbackHandlerEntry: null }, /context\.action\.fallbackHandlerEntry/],
    ['a fallbackHandlerEntry whose answered is a string', { fallbackHandlerEntry: { answered: 'yes' } }, /context\.action\.fallbackHandlerEntry\.answered/],
    ['an answered fallbackHandlerEntry without a value', { fallbackHandlerEntry: { answered: true } }, /context\.action\.fallbackHandlerEntry\.value/],
    ['an answered fallbackHandlerEntry of 31 bytes', { fallbackHandlerEntry: { answered: true, value: `0x${'ab'.repeat(31)}` } }, /context\.action\.fallbackHandlerEntry\.value/],
    ['an answered fallbackHandlerEntry of 33 bytes', { fallbackHandlerEntry: { answered: true, value: `0x${'ab'.repeat(33)}` } }, /context\.action\.fallbackHandlerEntry\.value/],
    ['an answered fallbackHandlerEntry that is not hex', { fallbackHandlerEntry: { answered: true, value: `0x${'zz'.repeat(32)}` } }, /context\.action\.fallbackHandlerEntry\.value/],
    ['a string actionImplementation', { actionImplementation: '0x4000000000000000000000000000000000000001' }, /context\.action\.actionImplementation/],
    ['a null actionImplementation', { actionImplementation: null }, /context\.action\.actionImplementation/],
    ['an actionImplementation whose answered is a string', { actionImplementation: { answered: 'yes' } }, /context\.action\.actionImplementation\.answered/],
    ['an answered actionImplementation without a value', { actionImplementation: { answered: true } }, /context\.action\.actionImplementation\.value/],
    ['an answered actionImplementation whose value is no address', { actionImplementation: { answered: true, value: 'nope' } }, /context\.action\.actionImplementation\.value/],
  ])('throws a TypeError for %s', (_name, change, path) => {
    const context = { ...CONTEXT, action: { ...CONTEXT.action, ...change } } as unknown as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(path);
  });

  it.each<[string, unknown]>([
    ['not an address', ['nope']],
    ['not a list', 'nope'],
  ])('throws a TypeError naming context.descriptor.auditedActions for an audited list %s', (_name, auditedActions) => {
    const context = { ...CONTEXT, descriptor: { ...DESCRIPTOR, auditedActions } } as unknown as typeof CONTEXT;

    expect(() => describeSetup(DRAFT, context)).toThrow(TypeError);
    expect(() => describeSetup(DRAFT, context)).toThrow(/context\.descriptor\.auditedActions/);
  });
});

/** What a call threw, failing loudly where it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }

  throw new Error('expected a throw');
}

describe('describeSetup and validateSetup share one guard over the action reads', () => {
  it.each<[string, (action: object) => unknown, RegExp]>([
    ['the action itself', () => 'not-an-object', /^context\.action /],
    ['actionInfo', (action) => ({ ...action, actionInfo: 'ambire' }), /^context\.action\.actionInfo /],
    ['supportsAccount', (action) => ({ ...action, supportsAccount: 'yes' }), /^context\.action\.supportsAccount /],
    ['accountHoldsCode', (action) => ({ ...action, accountHoldsCode: 1 }), /^context\.action\.accountHoldsCode /],
    ['actionInfo.answered', (action) => ({ ...action, actionInfo: { answered: 'yes' } }), /^context\.action\.actionInfo\.answered /],
    ['actionInfo.value', (action) => ({ ...action, actionInfo: { answered: true } }), /^context\.action\.actionInfo\.value /],
    ['manager', (action) => ({ ...action, manager: 'nope' }), /^context\.action\.manager /],
    ['manager.answered', (action) => ({ ...action, manager: { answered: 'yes' } }), /^context\.action\.manager\.answered /],
    ['fallbackHandlerEntry', (action) => ({ ...action, fallbackHandlerEntry: 'handler' }), /^context\.action\.fallbackHandlerEntry /],
    ['fallbackHandlerEntry.answered', (action) => ({ ...action, fallbackHandlerEntry: { answered: 1 } }), /^context\.action\.fallbackHandlerEntry\.answered /],
    ['fallbackHandlerEntry.value', (action) => ({ ...action, fallbackHandlerEntry: { answered: true, value: `0x${'ab'.repeat(20)}` } }), /^context\.action\.fallbackHandlerEntry\.value /],
    ['actionImplementation', (action) => ({ ...action, actionImplementation: 'implementation' }), /^context\.action\.actionImplementation /],
    ['actionImplementation.answered', (action) => ({ ...action, actionImplementation: { answered: 1 } }), /^context\.action\.actionImplementation\.answered /],
    ['actionImplementation.value', (action) => ({ ...action, actionImplementation: { answered: true, value: `0x${'ab'.repeat(32)}` } }), /^context\.action\.actionImplementation\.value /],
  ])('a malformed %s throws the same TypeError message from both', (_member, change, path) => {
    const described = thrownBy(() => describeSetup(DRAFT, { ...CONTEXT, action: change(CONTEXT.action) } as unknown as typeof CONTEXT));
    const validated = thrownBy(() =>
      validateSetup(VALIDATION_DRAFT, { ...SETUP_CONTEXT, action: change(SETUP_CONTEXT.action) } as unknown as SetupValidationContext),
    );

    expect(described).toBeInstanceOf(TypeError);
    expect(validated).toBeInstanceOf(TypeError);
    expect((described as Error).message).toMatch(path);
    expect((validated as Error).message).toBe((described as Error).message);
  });
});
