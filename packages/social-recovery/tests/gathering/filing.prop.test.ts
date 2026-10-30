import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fileReply, type Gathering, type Reply } from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { gatheringOf, ruleCase } from './arbitraries';
import { replyFor } from './support';

/** Files a reply, failing on a refusal. */
function file(record: Gathering, reply: Reply) {
  const result = fileReply(record, reply);

  if (result.outcome !== 'filed') throw new Error(result.reason.cause);

  return result;
}

describe('filing', () => {
  it('filing one reply twice equals filing it once, and the second names the first as displaced', () => {
    run(
      fc.property(ruleCase, fc.nat(), (c, pick) => {
        const record = gatheringOf(c);

        if (record.places.length === 0) return;

        const reply = replyFor(record, pick % record.places.length, { proof: '0x77' });
        const once = file(record, reply);
        const twice = file(once.gathering, reply);

        expect(twice.gathering).toStrictEqual(once.gathering);
        expect(twice.displaced).toStrictEqual(reply);
      }),
    );
  }, TIMEOUT);

  it('any filing sequence leaves one reply per place, the latest, in first-filed order', () => {
    run(
      fc.property(ruleCase, fc.array(fc.nat(), { maxLength: 12 }), (c, picks) => {
        let record = gatheringOf({ ...c, filed: [] });

        if (record.places.length === 0) return;

        const sequence = picks.map((p, i) => replyFor(record, p % record.places.length, { proof: `0x${(i + 16).toString(16)}` }));

        for (const reply of sequence) record = file(record, reply).gathering;

        const firstSeen = [...new Set(sequence.map((r) => r.place))];
        const latest = firstSeen.map((place) => sequence.filter((r) => r.place === place).at(-1));

        expect(record.replies).toStrictEqual(latest);
      }),
    );
  }, TIMEOUT);
});
