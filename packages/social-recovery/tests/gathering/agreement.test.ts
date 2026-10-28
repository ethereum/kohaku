import { describe, expect, it } from 'vitest';
import * as entry from '../../src/index';
import { count, decodeSetupBody, fileReply, filledPerClause, order, requests, satisfies, type Gathering, type Hex } from '../../src/index';
import { placeCount } from '../../src/gathering/edge';
import { readVector } from '../kat/read-vector';
import { approvalGathering, FLOOR, PINNED_AT, placeEntry, replyFor, TWO_CLAUSES_BODY, VALID_UNTIL } from './support';

const NOW = PINNED_AT + 60;
const BOUNDS = { default: 86_400, floor: FLOOR };

/** A record with replies filed at the given places, in the given order. */
function withReplies(record: Gathering, places: readonly number[]): Gathering {
  return places.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}: ${result.reason.cause}`);

    return result.gathering;
  }, record);
}

/** Every subset of the given places. */
const subsets = (places: readonly number[]): number[][] =>
  places.reduce<number[][]>((acc, p) => acc.concat(acc.map((s) => [...s, p])), [[]]);

describe('count and order agree on which places a reply fills', () => {
  it('a reply at a body place missing from the place map fills nothing for either', () => {
    const full = withReplies(approvalGathering(), [0, 1, 2, 3]);
    const short = { ...full, places: full.places.slice(0, 3) } as Gathering;
    const assessment = count(short, NOW, BOUNDS);

    expect(assessment.filled).toStrictEqual([0, 1, 2]);
    expect(assessment.missing).toStrictEqual([3]);
    expect(assessment.clauses).toStrictEqual([
      { clause: 0, threshold: 1, filled: 1 },
      { clause: 1, threshold: 2, filled: 2 },
    ]);
    expect(order(short, undefined, NOW).map((p) => p.place)).toStrictEqual([0, 1, 2]);
  });

  it('when the dropped place is needed, count says unsatisfied and order refuses', () => {
    const full = withReplies(approvalGathering(), [0, 1, 3]);
    const short = { ...full, places: full.places.slice(0, 3) } as Gathering;

    expect(count(short, NOW, BOUNDS).ruleSatisfied).toBe(false);
    expect(() => order(short, undefined, NOW)).toThrow(/satisfy the rule/);
    expect(() => order(short, [0, 1, 3], NOW)).toThrow();
  });
});

describe('order\'s expiry refusal', () => {
  it('refuses one second past the window and accepts at its end', () => {
    const record = withReplies(approvalGathering(), [0, 1, 2]);

    expect(() => order(record, undefined, VALID_UNTIL + 1)).toThrow(/window has passed/);
    expect(order(record, [0, 1, 2], VALID_UNTIL).map((p) => p.place)).toStrictEqual([0, 1, 2]);
  });

  it('the core entry no longer exports GATHERING_EXPIRY_ONLY_BOUNDS or GATHERING_DECIMAL_PATTERN, and exports FORMATS_DECIMAL_PATTERN', () => {
    expect(Object.keys(entry)).not.toContain('GATHERING_EXPIRY_ONLY_BOUNDS');
    expect(Object.keys(entry)).not.toContain('GATHERING_DECIMAL_PATTERN');
    expect(Object.keys(entry)).toContain('FORMATS_DECIMAL_PATTERN');
    expect(Object.keys(entry)).not.toContain('combinations');
  });
});

describe('every operation reads the same records', () => {
  it.each([
    ['version 2', { version: 2 }],
    ['version 0', { version: 0 }],
    ['the kind Gathering', { kind: 'Gathering' }],
    ['no kind', { kind: undefined }],
  ] as [string, Record<string, unknown>][])('a record at %s is refused by filing and thrown on by the others', (_label, change) => {
    const good = withReplies(approvalGathering(), [0, 1, 2]);
    const unread = { ...good, ...change } as Gathering;
    const result = fileReply(unread, replyFor(good, 3));

    expect(result.outcome === 'refused' && result.reason.cause).toBe('kind-or-version-unread');
    expect(() => count(unread, NOW, BOUNDS)).toThrow(TypeError);
    expect(() => order(unread, undefined, NOW)).toThrow(TypeError);
    expect(() => requests(unread)).toThrow(TypeError);
  });
});

describe('the gathering\'s rule arithmetic equals the shared rule counter', () => {
  const rows = readVector('setup-body.json').vectors;

  it.each(rows.map((r) => [r['id'] as string, (r.expected as { encoded: Hex }).encoded] as const))(
    '%s: clause counts and satisfaction for every subset of its places',
    (_name, encoded) => {
      const body = decodeSetupBody(encoded);
      const total = body.clauses.flatMap((c) => c.credentials).length;
      const places = Array.from({ length: total }, (_v, i) => placeEntry(i));

      for (const filled of subsets(places.map((p) => p.place))) {
        const assessment = count(withReplies(approvalGathering(places, encoded), filled), NOW, BOUNDS);

        expect(assessment.clauses.map((c) => c.filled)).toStrictEqual(filledPerClause(body, filled));
        expect(assessment.ruleSatisfied).toBe(satisfies(body, filled));
        expect(assessment.filled.length + assessment.missing.length).toBe(total);
      }
    },
  );

  it.each(rows.map((r) => [r['id'] as string, (r.expected as { encoded: Hex }).encoded] as const))(
    '%s: placeCount equals the flattened credential count',
    (_name, encoded) => {
      const body = decodeSetupBody(encoded);

      expect(placeCount(body)).toBe(body.clauses.flatMap((c) => c.credentials).length);
    },
  );

  it('placeCount of two-clauses is four', () => {
    expect(placeCount(decodeSetupBody(TWO_CLAUSES_BODY))).toBe(4);
  });
});
