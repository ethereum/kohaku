import { describe, expect, it } from 'vitest';
import { fileReply, order, type Gathering, type GatheringPlace, type Reply } from '../../src/index';
import {
  approvalGathering,
  bodyOver,
  cancellationGathering,
  methodAt,
  PINNED_AT,
  placeEntry,
  readFixture,
  replyFor,
  ruleHolds,
  VALID_UNTIL,
} from './support';

const NOW = PINNED_AT + 60;

/** A record with replies filed at the given places, in the given order. */
function withReplies(record: Gathering, places: readonly number[]): Gathering {
  return places.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}: ${result.reason.cause}`);

    return result.gathering;
  }, record);
}

type CriteriaInput = {
  clauses: { threshold: number; places: number[] }[];
  places: { place: number; method: number; standing: GatheringPlace['standing']; stoppable: boolean }[];
  filed: number[];
  ignoresPause: boolean;
  refiled?: number[];
};

/** The gathering a criteria row describes, its replies filed (and refiled) in the row's order. */
function criteriaRecord(input: CriteriaInput): Gathering {
  const places = input.places.map((p) => placeEntry(p.place, { method: methodAt(p.method), standing: p.standing, stoppable: p.stoppable }));
  const record = withReplies(approvalGathering(places, bodyOver(input.clauses, places, input.ignoresPause)), input.filed);

  return (input.refiled ?? []).reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place, { proof: '0xfeed' }));

    if (result.outcome !== 'filed') throw new Error('refile refused');

    return result.gathering;
  }, record);
}

describe('order: the four criteria (tester-authored boundary rows)', () => {
  const fixture = readFixture('order-criteria.json');

  it.each(fixture.vectors.map((r) => [r['id'] as string, r] as const))('%s', (_name, row) => {
    const record = criteriaRecord(row.input as CriteriaInput);
    const chosen = order(record, undefined, NOW);
    const expected = (row.expected as { chosen: number[] }).chosen;

    expect(chosen.map((p) => p.place)).toStrictEqual(expected);
  });

  it('each chosen proof place carries the reply\'s method, config, salt and proof at that place', () => {
    const record = withReplies(approvalGathering(), [2, 0, 3]);
    const chosen = order(record, undefined, NOW);
    const replyAt = (place: number) => record.replies.find((r) => r.place === place) as Reply;

    expect(chosen.map((p) => p.place)).toStrictEqual([0, 2, 3]);
    expect(chosen).toStrictEqual(
      [0, 2, 3].map((place) => {
        const { method, config, salt, proof } = replyAt(place);

        return { place, method, config, salt, proof };
      }),
    );
  });

  it('carries the latest reply at a refiled place', () => {
    const record = withReplies(approvalGathering(), [0, 1, 2]);
    const refiled = fileReply(record, replyFor(record, 1, { proof: '0x0b0b' }));

    if (refiled.outcome !== 'filed') throw new Error('refused');

    expect(order(refiled.gathering, undefined, NOW).find((p) => p.place === 1)?.proof).toBe('0x0b0b');
  });

  it('orders a cancellation gathering the same way', () => {
    const record = withReplies(cancellationGathering(), [3, 2, 1, 0]);

    expect(order(record, undefined, NOW).map((p) => p.place)).toStrictEqual([0, 2, 3]);
  });
});

describe('order: the selection', () => {
  const record = withReplies(approvalGathering(), [0, 1, 2, 3]);

  it('a satisfying selection overrides the choice, even a larger set', () => {
    expect(order(record, [0, 1, 2, 3], NOW).map((p) => p.place)).toStrictEqual([0, 1, 2, 3]);
    expect(order(record, [0, 1, 3], NOW).map((p) => p.place)).toStrictEqual([0, 1, 3]);
  });

  it('a selection given out of order comes back strictly increasing', () => {
    expect(order(record, [3, 0, 2], NOW).map((p) => p.place)).toStrictEqual([0, 2, 3]);
  });

  it('a selection including a stopped place is honoured', () => {
    const places = [0, 1, 2, 3].map((p) => placeEntry(p, p === 1 ? { standing: 'stopped', stoppable: true } : {}));
    const stopped = withReplies(approvalGathering(places), [0, 1, 2, 3]);

    expect(order(stopped, undefined, NOW).map((p) => p.place)).toStrictEqual([0, 2, 3]);
    expect(order(stopped, [0, 1, 2], NOW).map((p) => p.place)).toStrictEqual([0, 1, 2]);
  });

  it('a selection naming a stopped place is accepted while stops reach the setup', () => {
    const places = [placeEntry(0, { standing: 'stopped', stoppable: true }), placeEntry(1)];
    const stopped = withReplies(approvalGathering(places, bodyOver([{ threshold: 1, places: [0, 1] }], places, false)), [0, 1]);

    expect(order(stopped, undefined, NOW).map((p) => p.place)).toStrictEqual([1]);
    expect(order(stopped, [0], NOW).map((p) => p.place)).toStrictEqual([0]);
  });

  it('a selection naming a place no reply fills is refused, even when its filled part satisfies', () => {
    const partial = withReplies(approvalGathering(), [0, 1, 2]);

    expect(() => order(partial, [0, 1, 2, 3], NOW)).toThrow();
  });

  it.each([
    ['one short of the second clause', [0, 1]],
    ['missing the first clause', [1, 2, 3]],
    ['empty', []],
  ] as [string, number[]][])('a selection %s is refused', (_label, selection) => {
    expect(ruleHolds(record.request.setupBody, selection)).toBe(false);
    expect(() => order(record, selection, NOW)).toThrow(/satisfy the rule/);
  });
});

describe('order: the two refusals', () => {
  it('refuses a record whose window has passed, by one second', () => {
    const record = withReplies(approvalGathering(), [0, 1, 2]);

    expect(() => order(record, undefined, VALID_UNTIL + 1)).toThrow(/window has passed/);
    expect(order(record, undefined, VALID_UNTIL).map((p) => p.place)).toStrictEqual([0, 1, 2]);
  });

  it('refuses replies that do not satisfy the rule', () => {
    expect(() => order(withReplies(approvalGathering(), [1, 2, 3]), undefined, NOW)).toThrow(/satisfy the rule/);
    expect(() => order(approvalGathering(), undefined, NOW)).toThrow(/satisfy the rule/);
  });

  it('refuses a body with no clauses and an all-zero rule as unsatisfied', () => {
    const places = [placeEntry(0)];
    const zero = withReplies(approvalGathering(places, bodyOver([{ threshold: 0, places: [0] }], places)), [0]);

    expect(() => order(approvalGathering([], bodyOver([], [])), undefined, NOW)).toThrow(/satisfy the rule/);
    expect(() => order(zero, undefined, NOW)).toThrow(/satisfy the rule/);
  });

  it('refuses nothing else: a moment far before the pinned block, a short window and a late cancel all order', () => {
    const late = withReplies(cancellationGathering(undefined, undefined, VALID_UNTIL - 1), [0, 1, 2]);
    const short = withReplies(approvalGathering(), [0, 1, 2]);
    const shortRecord = { ...short, request: { ...short.request, block: { ...short.request.block, timestamp: String(VALID_UNTIL - 10) } } } as Gathering;

    expect(order(late, undefined, NOW).map((p) => p.place)).toStrictEqual([0, 1, 2]);
    expect(order(shortRecord, undefined, VALID_UNTIL - 10).map((p) => p.place)).toStrictEqual([0, 1, 2]);
    expect(order(short, undefined, 0).map((p) => p.place)).toStrictEqual([0, 1, 2]);
  });
});
