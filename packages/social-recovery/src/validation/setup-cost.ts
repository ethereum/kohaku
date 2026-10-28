import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { Address, SetupDraft } from '../interfaces';
import type { Findings, MethodCost, PlacedCredential } from '../types/validation';
import { addError, methodTable } from './common';

/** The cost table by checksummed method address, refusing a malformed or repeated entry. */
function costTable(costs: readonly MethodCost[]): Map<Address, number> {
  assertArray(costs, 'context.costs');

  return methodTable(
    costs.map((entry, index) => {
      assertObject(entry, `context.costs[${index}]`);
      assertUintNumber(entry.gas, FORMATS_SAFE_INTEGER_BITS, `context.costs[${index}].gas`);

      return [normalizeAddress(entry.method, `context.costs[${index}].method`), entry.gas];
    }),
    'context.costs',
  );
}

/**
 * `rule.too-wide` when the costliest set of places that satisfies the rule costs more gas than the client's bound.
 * Raises nothing where the rule has no satisfying set or the table lacks a method the set could name.
 */
export function ruleCostFindings(
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  costs: readonly MethodCost[],
  bound: number,
  findings: Findings,
): void {
  const table = costTable(costs);
  const { clauses } = draft;

  if (clauses.length === 0 || clauses.every((clause) => clause.threshold === 0)) return;

  if (clauses.some((clause) => clause.threshold > clause.credentials.length)) return;

  const candidates = credentials.filter((credential) => (clauses[credential.clause]?.threshold ?? 0) > 0);

  if (candidates.some((credential) => !table.has(credential.method))) return;

  const gasOf = (credential: PlacedCredential): number => table.get(credential.method) ?? 0;
  const chosen = clauses
    .flatMap(({ threshold }, clause) =>
      candidates
        .filter((credential) => credential.clause === clause)
        .sort((left, right) => gasOf(right) - gasOf(left) || left.place - right.place)
        .slice(0, threshold),
    )
    .sort((left, right) => left.place - right.place);
  const byMethod = new Map<Address, number>();

  for (const credential of chosen) byMethod.set(credential.method, (byMethod.get(credential.method) ?? 0) + gasOf(credential));

  const cost = chosen.reduce((sum, credential) => sum + gasOf(credential), 0);

  if (cost <= bound) return;

  addError(findings, 'rule.too-wide', 'setup', {
    places: chosen.map((credential) => credential.place),
    methods: [...byMethod].map(([method, gas]) => ({ method, gas })),
    cost,
    bound,
  });
}
