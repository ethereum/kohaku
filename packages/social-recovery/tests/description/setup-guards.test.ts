import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, type MethodDescriptionReads } from '../../src/index';
import { CANDIDATE_A, CANDIDATE_B, CONFIGURATION, CONTEXT, DRAFT, ZKPASSPORT, withMethod } from './setup-fixtures';

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
