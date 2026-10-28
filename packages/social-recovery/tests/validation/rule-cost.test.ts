import { describe, expect, it } from 'vitest';
import { validateSetup, type MethodCost } from '../../src/index';
import { CONFIGURATION, DRAFT, ECDSA, PASSKEY, SETUP_CONTEXT, UNSHIPPED, credential, findingsOf, withClauses } from './fixtures';

const COSTS: MethodCost[] = [
  { method: ECDSA, gas: 3_000_000 },
  { method: PASSKEY, gas: 4_000_000 },
];

const withCosts = (costs: readonly MethodCost[], ruleCostBound = CONFIGURATION.ruleCostBound) => ({
  ...SETUP_CONTEXT,
  costs,
  configuration: { ...CONFIGURATION, ruleCostBound },
});

describe('validateSetup rule.too-wide', () => {
  it('raises rule.too-wide when the costliest satisfying set runs one gas past the bound', () => {
    expect(findingsOf(validateSetup(DRAFT, withCosts(COSTS, 6_999_999)), 'rule.too-wide')).toEqual([
      {
        code: 'rule.too-wide',
        subject: 'setup',
        values: {
          places: [0, 1],
          methods: [
            { method: ECDSA, gas: 3_000_000 },
            { method: PASSKEY, gas: 4_000_000 },
          ],
          cost: 7_000_000,
          bound: 6_999_999,
        },
      },
    ]);
  });

  it('does not raise rule.too-wide with the set costing exactly the bound', () => {
    expect(validateSetup(DRAFT, withCosts(COSTS, 7_000_000)).errors).toEqual([]);
  });

  it('prices the costliest credentials of a clause rather than the first ones', () => {
    const draft = withClauses([{ threshold: 1, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2)] }]);

    expect(findingsOf(validateSetup(draft, withCosts(COSTS, 3_500_000)), 'rule.too-wide')).toEqual([
      {
        code: 'rule.too-wide',
        subject: 'setup',
        values: { places: [1], methods: [{ method: PASSKEY, gas: 4_000_000 }], cost: 4_000_000, bound: 3_500_000 },
      },
    ]);
  });

  it('sums across clauses and reads the shipped 10,000,000 gas bound from the configuration', () => {
    const draft = withClauses([
      { threshold: 2, credentials: [credential(PASSKEY, 1), credential(PASSKEY, 2), credential(ECDSA, 3)] },
      { threshold: 1, credentials: [credential(ECDSA, 4), credential(PASSKEY, 5)] },
    ]);
    const [finding] = findingsOf(validateSetup(draft, withCosts(COSTS)), 'rule.too-wide');

    expect(finding?.values).toEqual({
      places: [0, 1, 4],
      methods: [{ method: PASSKEY, gas: 12_000_000 }],
      cost: 12_000_000,
      bound: 10_000_000,
    });
  });

  it('is silent when a method the rule could spend has no cost entry', () => {
    const draft = withClauses([{ threshold: 1, credentials: [credential(PASSKEY, 1), credential(UNSHIPPED, 2)] }]);
    const context = { ...withCosts(COSTS, 1), descriptor: { ...SETUP_CONTEXT.descriptor, shippedMethods: [ECDSA, PASSKEY, UNSHIPPED] } };

    expect(findingsOf(validateSetup(draft, context), 'rule.too-wide')).toEqual([]);
    expect(findingsOf(validateSetup(DRAFT, withCosts([{ method: ECDSA, gas: 3_000_000 }], 1)), 'rule.too-wide')).toEqual([]);
  });

  it('is silent with an empty cost table', () => {
    expect(validateSetup(DRAFT, withCosts([], 0)).errors).toEqual([]);
  });

  it('leaves a zero-threshold clause out of the set, so its unpriced method does not silence the check', () => {
    const draft = withClauses([
      { threshold: 0, credentials: [credential(UNSHIPPED, 1)] },
      { threshold: 1, credentials: [credential(PASSKEY, 2)] },
    ]);
    const context = { ...withCosts(COSTS, 3_999_999), descriptor: { ...SETUP_CONTEXT.descriptor, shippedMethods: [ECDSA, PASSKEY, UNSHIPPED] } };

    expect(findingsOf(validateSetup(draft, context), 'rule.too-wide').map((finding) => finding.values['places'])).toEqual([[1]]);
  });
});
