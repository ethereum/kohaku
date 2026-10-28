import { decodeSetupBody } from '../formats/setup-body';
import type { Assessment, Gathering, Moment, RequestWindowBounds } from '../interfaces';
import { filledPerClause, satisfies, windowFindings } from '../validation';
import { assertGatheringRead, filedPlaces, placeCount, windowFactsOf } from './edge';

/**
 * The record's progress: filled and missing places, each clause's count, whether the rule is satisfied,
 * and the request findings the window and the moment reach. Throws on a record this build does not read.
 */
export function count(record: Gathering, now: Moment, bounds: RequestWindowBounds): Assessment {
  assertGatheringRead(record);

  const body = decodeSetupBody(record.request.setupBody);
  const filled = [...filedPlaces(record).keys()].sort((left, right) => left - right);
  const filledSet = new Set(filled);
  const perClause = filledPerClause(body, filled);
  const { errors, warnings } = windowFindings(windowFactsOf(record), now, bounds);

  return {
    filled,
    missing: Array.from({ length: placeCount(body) }, (_, place) => place).filter((place) => !filledSet.has(place)),
    clauses: body.clauses.map(({ threshold }, clause) => ({ clause, threshold, filled: perClause[clause] ?? 0 })),
    ruleSatisfied: satisfies(body, filled),
    findings: [...errors, ...warnings],
  };
}
