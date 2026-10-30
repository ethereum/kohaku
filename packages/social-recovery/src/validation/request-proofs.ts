import { assertObject, normalizeAddress } from '../formats/guards';
import type { Address, ReadResult } from '../interfaces';
import type { CheckedRequest, Findings, RequestValidationContext } from '../types/validation';
import { addError, addWarning, methodTable, normalizeAddresses } from './common';
import { filledPerClause, satisfies } from './rule-count';

/** `proof.places-unordered` for every proof whose place does not exceed the one before it. */
export function placeOrderFindings(request: CheckedRequest, findings: Findings): void {
  request.proofs.forEach(({ place }, index) => {
    const previous = request.proofs[index - 1];

    if (previous !== undefined && place <= previous.place) addError(findings, 'proof.places-unordered', 'request', { place });
  });
}

/**
 * `proof.place-out-of-range` per proof past the body's credential count, and `request.rule-unsatisfied`
 * per clause whose filled places miss its threshold, or once for a rule nothing satisfies.
 */
export function ruleCountFindings(request: CheckedRequest, findings: Findings): void {
  const { body } = request;

  if (body === undefined) return;

  const count = body.clauses.reduce((sum, { credentials }) => sum + credentials.length, 0);

  for (const { place } of request.proofs) {
    if (place >= count) addError(findings, 'proof.place-out-of-range', 'request', { place, count });
  }

  const places = request.proofs.map(({ place }) => place);

  if (satisfies(body, places)) return;

  if (body.clauses.length === 0 || body.clauses.every(({ threshold }) => threshold === 0)) {
    addError(findings, 'request.rule-unsatisfied', 'request', {
      clauses: body.clauses.length,
      allThresholdsZero: body.clauses.length > 0,
    });

    return;
  }

  const filled = filledPerClause(body, places);

  body.clauses.forEach(({ threshold }, clause) => {
    const own = filled[clause] ?? 0;

    if (own < threshold) addError(findings, 'request.rule-unsatisfied', 'request', { clause, threshold, filled: own });
  });
}

/** The pause reads by checksummed method, refusing a malformed or repeated entry. */
function pauseTable(context: RequestValidationContext): Map<Address, ReadResult<boolean>> {
  return methodTable(
    context.paused.map((entry, index) => {
      assertObject(entry, `context.paused[${index}]`);
      assertObject(entry.paused, `context.paused[${index}].paused`);

      return [normalizeAddress(entry.method, `context.paused[${index}].method`), entry.paused];
    }),
    'context.paused',
  );
}

/** `request.method-stopped` per place whose method answers stopped while the setup lets stops reach its attempts. */
export function stoppedFindings(request: CheckedRequest, context: RequestValidationContext, findings: Findings): void {
  const table = pauseTable(context);
  const ignoresPause = request.body?.ignoresPause;

  if (ignoresPause !== false) return;

  const judged = new Set<number>();

  for (const { place, method } of request.proofs) {
    const paused = table.get(method);

    if (judged.has(place)) continue;

    judged.add(place);

    if (paused === undefined) throw new TypeError(`context.paused holds no read for ${method}`);

    if (paused.answered && paused.value) {
      addError(findings, 'request.method-stopped', 'request', { place, method, ignoresPause });
    }
  }
}

/** `method.unshipped` once, naming the methods the request's places name that no registered implementation serves. */
export function unservedFindings(request: CheckedRequest, context: RequestValidationContext, findings: Findings): void {
  const implemented = normalizeAddresses(context.implementedMethods, 'context.implementedMethods');
  const methods = [...new Set(request.proofs.map(({ method }) => method))].filter((method) => !implemented.includes(method));

  if (methods.length > 0) addWarning(findings, 'method.unshipped', 'request', { methods });
}
