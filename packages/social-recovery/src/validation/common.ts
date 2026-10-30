export { normalizeAddresses } from '../formats/guards';
import type { Address, ErrorCode, FindingSubject, FindingValues, ValidationResult, WarningCode } from '../interfaces';
import type { Findings } from '../types/validation';

/** An empty collection. */
export const emptyFindings = (): Findings => ({ errors: [], warnings: [] });

/** Appends one error. */
export function addError(findings: Findings, code: ErrorCode, subject: FindingSubject, values: FindingValues): void {
  findings.errors.push({ code, subject, values });
}

/** Appends one warning. */
export function addWarning(findings: Findings, code: WarningCode, subject: FindingSubject, values: FindingValues): void {
  findings.warnings.push({ code, subject, values });
}

/** Appends another result's findings in their order. */
export function addAll(findings: Findings, result: ValidationResult): void {
  findings.errors.push(...result.errors);
  findings.warnings.push(...result.warnings);
}

/** A table keyed by method address, refusing a method that appears twice since one entry would silently replace the other. */
export function methodTable<Value>(entries: readonly (readonly [Address, Value])[], name: string): Map<Address, Value> {
  const table = new Map<Address, Value>();

  for (const [method, value] of entries) {
    if (table.has(method)) throw new TypeError(`${name} holds ${method} more than once`);

    table.set(method, value);
  }

  return table;
}
