import { describe, expect, it } from 'vitest';
import { count, fileReply, order, placeMap, requests, seed, type Configuration, type SetupBody } from '../../src/index';
import {
  ACCOUNT,
  approvalGathering,
  bodyOver,
  cancellationGathering,
  credentialOf,
  deepFreeze,
  FLOOR,
  METHOD,
  PINNED_AT,
  placeEntry,
  replyFor,
  sharedObjects,
} from './support';

const NOW = PINNED_AT + 60;
const BOUNDS = deepFreeze({ default: 86_400, floor: FLOOR });

/** A deep-frozen gathering with replies at places 0..2, a snapshot of it, and one more reply to file. */
function frozenCase(make: typeof approvalGathering | typeof cancellationGathering) {
  let record = make();

  for (const place of [0, 1, 2]) {
    const result = fileReply(record, replyFor(record, place));

    if (result.outcome !== 'filed') throw new Error('refused');

    record = result.gathering;
  }

  return { record: deepFreeze(record), snapshot: structuredClone(record), next: deepFreeze(replyFor(record, 3)) };
}

describe.each([
  ['approval', approvalGathering],
  ['cancellation', cancellationGathering],
] as const)('purity over a deep-frozen %s gathering', (_label, make) => {
  it('fileReply filing a new place mutates nothing and shares no object with its inputs', () => {
    const { record, snapshot, next } = frozenCase(make);
    const result = fileReply(record, next);

    expect(result.outcome).toBe('filed');
    expect(record).toStrictEqual(snapshot);
    expect(sharedObjects(result, [record, next])).toStrictEqual([]);
  });

  it('fileReply replacing a place mutates nothing and its displaced reply is a copy', () => {
    const { record, snapshot } = frozenCase(make);
    const again = deepFreeze(replyFor(record, 1, { proof: '0x99' }));
    const result = fileReply(record, again);

    expect(result.outcome === 'filed' && result.displaced).toStrictEqual(snapshot.replies[1]);
    expect(record).toStrictEqual(snapshot);
    expect(sharedObjects(result, [record, again])).toStrictEqual([]);
  });

  it('fileReply refusing mutates nothing and returns an equal record that shares nothing', () => {
    const { record, snapshot, next } = frozenCase(make);
    const bad = deepFreeze({ ...next, digest: `0x${'00'.repeat(32)}` as const });
    const result = fileReply(record, bad);

    expect(result.gathering).toStrictEqual(snapshot);
    expect(sharedObjects(result, [record, bad])).toStrictEqual([]);
  });

  it('requests, count and order mutate nothing and share no object with the record', () => {
    const { record, snapshot } = frozenCase(make);
    const selection = deepFreeze([2, 1, 0]);
    const outputs = [requests(record), count(record, NOW, BOUNDS), order(record, undefined, NOW), order(record, selection, NOW)];

    expect(record).toStrictEqual(snapshot);
    expect(selection).toStrictEqual([2, 1, 0]);
    expect(sharedObjects(outputs, [record, BOUNDS, selection])).toStrictEqual([]);
  });

  it('the same inputs give equal outputs on every call', () => {
    const { record, next } = frozenCase(make);

    expect(fileReply(record, next)).toStrictEqual(fileReply(record, next));
    expect(requests(record)).toStrictEqual(requests(record));
    expect(count(record, NOW, BOUNDS)).toStrictEqual(count(record, NOW, BOUNDS));
    expect(order(record, undefined, NOW)).toStrictEqual(order(record, undefined, NOW));
  });

  it('seed mutates neither argument and shares no object with them', () => {
    const places = deepFreeze([0, 1, 2].map((p) => placeEntry(p)));
    const record = make(places, bodyOver([{ threshold: 1, places: [0] }, { threshold: 2, places: [1, 2] }], places));
    const members = deepFreeze({ purpose: record.purpose, request: record.request } as Parameters<typeof seed>[0]);
    const snapshot = structuredClone({ members, places });
    const seeded = seed(members, places);

    expect({ members, places }).toStrictEqual(snapshot);
    expect(seeded.replies).toStrictEqual([]);
    expect(sharedObjects(seeded, [members, places])).toStrictEqual([]);
  });
});

describe('placeMap purity', () => {
  it('mutates nothing it was given and shares no object with it', () => {
    const configuration: Configuration = deepFreeze({
      wait: 0,
      ignoresPause: false,
      clauses: [{ threshold: 1, credentials: [{ method: METHOD, config: '0x01', salt: `0x${'01'.repeat(32)}`, label: 'Ana' }] }],
    });
    const body: SetupBody = deepFreeze({
      wait: 0,
      ignoresPause: false,
      clauses: [{ threshold: 1, credentials: [credentialOf(METHOD, '0x01', `0x${'01'.repeat(32)}`)] }],
    });
    const standings = deepFreeze([{ standing: 'not-stopped', stoppable: false, credentialHoldsCode: false }] as const);
    const snapshot = structuredClone({ configuration, body, standings });
    const out = placeMap(body, configuration, standings, ACCOUNT);

    expect({ configuration, body, standings }).toStrictEqual(snapshot);
    expect(out).toHaveLength(1);
    expect(sharedObjects(out, [configuration, body, standings])).toStrictEqual([]);
  });
});
