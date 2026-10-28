import type { SetupBody } from '../types';
import type { ClausePool, FiledPlace } from '../types/gathering';
import { clausePlaces } from '../validation';

/** Every way to pick `size` items from `items`, in order, yielded one at a time so memory stays linear in `items`. */
export function* combinations<T>(items: readonly T[], size: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === size) {
    yield [...prefix];

    return;
  }

  for (let index = start; index < items.length; index++) {
    prefix.push(items[index] as T);
    yield* combinations(items, size, index + 1, prefix);
    prefix.pop();
  }
}

/** Each clause's threshold and filled places in filing order, computed once per choice. */
function clausePools(body: SetupBody, filled: ReadonlyMap<number, FiledPlace>): ClausePool[] {
  return clausePlaces(body).map((places, clause) => ({
    threshold: body.clauses[clause]?.threshold ?? 0,
    pool: places
      .map((place) => filled.get(place))
      .filter((entry): entry is FiledPlace => entry !== undefined)
      .sort((left, right) => left.filedAt - right.filedAt),
  }));
}

/** Per clause the earliest-filed places among the allowed ones, as many as its threshold; undefined where a clause falls short. */
function earliest(clauses: readonly ClausePool[], allowed: (entry: FiledPlace) => boolean): FiledPlace[] | undefined {
  const chosen: FiledPlace[] = [];

  for (const { threshold, pool: all } of clauses) {
    const pool = all.filter(allowed);

    if (pool.length < threshold) {
      return undefined;
    }

    chosen.push(...pool.slice(0, threshold));
  }

  return chosen;
}

/** Whether `left` was filed earlier than `right`, comparing their ascending filing positions in turn. */
function filedEarlier(left: readonly FiledPlace[], right: readonly FiledPlace[]): boolean {
  const leftOrder = left.map((entry) => entry.filedAt).sort((a, b) => a - b);
  const rightOrder = right.map((entry) => entry.filedAt).sort((a, b) => a - b);
  const differs = leftOrder.findIndex((position, index) => position !== rightOrder[index]);

  return differs !== -1 && (leftOrder[differs] ?? 0) < (rightOrder[differs] ?? 0);
}

/**
 * The preferred satisfying set among the filled places, or undefined where none satisfies:
 * no stopped method where such a set exists and stops reach the setup, then the smallest set,
 * then the fewest distinct stoppable methods, then the earliest filed replies.
 */
export function preferredSet(body: SetupBody, filled: ReadonlyMap<number, FiledPlace>): FiledPlace[] | undefined {
  const avoidsStopped = (entry: FiledPlace): boolean => body.ignoresPause || entry.entry.standing !== 'stopped';
  const clauses = clausePools(body, filled);
  const unstopped = earliest(clauses, avoidsStopped) !== undefined;
  const inPool = (entry: FiledPlace): boolean => !unstopped || avoidsStopped(entry);
  const stoppable = [
    ...new Set([...filled.values()].filter((entry) => inPool(entry) && entry.entry.stoppable).map((entry) => entry.entry.method.toLowerCase())),
  ];

  for (let size = 0; size <= stoppable.length; size++) {
    let best: FiledPlace[] | undefined;

    for (const methods of combinations(stoppable, size)) {
      const named = new Set(methods);
      const candidate = earliest(
        clauses,
        (entry) => inPool(entry) && (!entry.entry.stoppable || named.has(entry.entry.method.toLowerCase())),
      );

      if (candidate !== undefined && (best === undefined || filedEarlier(candidate, best))) {
        best = candidate;
      }
    }

    if (best !== undefined) {
      return best;
    }
  }

  return undefined;
}
