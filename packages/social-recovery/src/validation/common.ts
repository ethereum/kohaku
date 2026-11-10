import { getAddress, size, slice } from 'viem';
export { normalizeAddresses } from '../formats/guards';
import { FORMATS_ADDRESS_BYTES, FORMATS_ZERO_ADDRESS } from '../constants';
import { assertAddress, assertBool, assertBytes32, assertObject, lowerHex } from '../formats/guards';
import type { Address, DescribedFallbackHandler, ErrorCode, FindingSubject, FindingValues, Hex, ValidationResult, WarningCode } from '../interfaces';
import type { ActionReads, Findings } from '../types/validation';

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

/** Refuses action reads whose records are not the shapes they declare, an answered `actionInfo` without a value among them. */
export function assertActionReads(action: ActionReads, path: string): void {
  assertObject(action, path);
  assertObject(action.actionInfo, `${path}.actionInfo`);
  assertBool(action.actionInfo.answered, `${path}.actionInfo.answered`);

  if (action.actionInfo.answered) assertObject(action.actionInfo.value, `${path}.actionInfo.value`);

  assertBool(action.supportsAccount, `${path}.supportsAccount`);
  assertBool(action.accountHoldsCode, `${path}.accountHoldsCode`);
  assertObject(action.manager, `${path}.manager`);
  assertBool(action.manager.answered, `${path}.manager.answered`);

  if (action.manager.answered) assertAddress(action.manager.value, `${path}.manager.value`);

  const entry = action.fallbackHandlerEntry;

  if (entry !== undefined) {
    assertObject(entry, `${path}.fallbackHandlerEntry`);
    assertBool(entry.answered, `${path}.fallbackHandlerEntry.answered`);

    if (entry.answered) assertBytes32(entry.value, `${path}.fallbackHandlerEntry.value`);
  }
}

/** The fallback-handler word in lower case, beside the address the account delegatecalls, its low 20 bytes, where they are not zero. */
export function fallbackHandlerOf(entry: Hex): DescribedFallbackHandler {
  const word = lowerHex(entry);
  const low = slice(word, size(word) - FORMATS_ADDRESS_BYTES);

  return low === FORMATS_ZERO_ADDRESS ? { entry: word } : { entry: word, handler: getAddress(low) };
}
