import type { SetupBody } from '../types';

/** Per clause, the flat places its credentials fill, numbered across all clauses in body order from 0. */
export function clausePlaces(body: SetupBody): number[][] {
  let start = 0;

  return body.clauses.map(({ credentials }) => {
    const places = credentials.map((_, index) => start + index);

    start += credentials.length;

    return places;
  });
}

/** Per clause, how many distinct places of the given ones fall inside it; a place past the body's count counts nowhere. */
export function filledPerClause(body: SetupBody, places: Iterable<number>): number[] {
  const filled = new Set(places);

  return clausePlaces(body).map((own) => own.filter((place) => filled.has(place)).length);
}

/**
 * Whether the given places satisfy the rule as the manager counts it: every clause meets its threshold.
 * A body with no clauses, or with every threshold at zero, is satisfied by nothing.
 */
export function satisfies(body: SetupBody, places: Iterable<number>): boolean {
  if (body.clauses.length === 0 || body.clauses.every(({ threshold }) => threshold === 0)) return false;

  const filled = filledPerClause(body, places);

  return body.clauses.every(({ threshold }, clause) => (filled[clause] ?? 0) >= threshold);
}
