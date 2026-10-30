import { VALIDATION_THRESHOLD_MAX } from '../constants';
import type { Address, SetupDraft } from '../interfaces';
import type { Findings, PlacedCredential } from '../types/validation';
import { addError, addWarning } from './common';

/** The errors the rule's own shape reaches: an empty rule or clause, and a threshold no clause can meet or hold. */
export function ruleShapeFindings(draft: SetupDraft, findings: Findings): void {
  const { clauses } = draft;

  if (clauses.length === 0) addError(findings, 'rule.empty', 'setup', { clauses: 0 });

  if (clauses.length > 0 && clauses.every((clause) => clause.threshold === 0)) {
    addError(findings, 'rule.all-thresholds-zero', 'setup', {
      clauses: clauses.map((_, clause) => ({ clause, threshold: 0 })),
    });
  }

  clauses.forEach(({ threshold, credentials }, clause) => {
    const count = credentials.length;

    if (count === 0) addError(findings, 'clause.empty', 'clause', { clause, count });

    if (threshold > count) addError(findings, 'clause.threshold-above-count', 'clause', { clause, threshold, count });

    if (threshold > VALIDATION_THRESHOLD_MAX) {
      addError(findings, 'clause.threshold-too-wide', 'clause', { clause, threshold, maximum: VALIDATION_THRESHOLD_MAX });
    }
  });
}

/** Pairs of places naming one method and config, each later place against the first that named the pair. */
export function duplicateFindings(credentials: readonly PlacedCredential[], findings: Findings): void {
  const firstPlace = new Map<string, number>();

  for (const { place, method, config } of credentials) {
    const pair = `${method}:${config}`;
    const first = firstPlace.get(pair);

    if (first === undefined) firstPlace.set(pair, place);
    else addError(findings, 'credential.duplicate', 'credential', { places: [first, place], method, config });
  }
}

/** The warnings a clause's own shape reaches: a single point, a zero threshold beside other clauses, one shared method. */
export function clauseShapeFindings(draft: SetupDraft, credentials: readonly PlacedCredential[], findings: Findings): void {
  const { clauses } = draft;
  const allZero = clauses.every((clause) => clause.threshold === 0);

  clauses.forEach(({ threshold }, clause) => {
    const own = credentials.filter((credential) => credential.clause === clause);
    const count = own.length;

    if (count > 0 && (threshold === count || count === 1)) addWarning(findings, 'clause.single-point', 'clause', { clause, threshold, count });

    if (threshold === 0 && !allZero) {
      const otherClauses = clauses.map((_, index) => index).filter((index) => index !== clause);

      addWarning(findings, 'clause.threshold-zero', 'clause', { clause, otherClauses });
    }

    const method = own[0]?.method;

    if (count > 1 && own.every((credential) => credential.method === method)) {
      addWarning(findings, 'clause.shared-failure', 'clause', { clause, method: method as Address, count });
    }
  });
}

/** Labels the integrator's contact book gave more than one credential, as one person behind several places. */
export function repeatedPersonFindings(credentials: readonly PlacedCredential[], findings: Findings): void {
  const placesByLabel = new Map<string, number[]>();

  for (const { label, place } of credentials) {
    if (label !== undefined) placesByLabel.set(label, [...(placesByLabel.get(label) ?? []), place]);
  }

  for (const [label, places] of placesByLabel) {
    if (places.length > 1) addWarning(findings, 'rule.repeated-person', 'setup', { label, places });
  }
}
