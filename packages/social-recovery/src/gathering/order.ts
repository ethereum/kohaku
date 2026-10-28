import { GATHERING_RULE_UNSATISFIED_MESSAGE, GATHERING_SELECTION_UNFILLED_MESSAGE, GATHERING_WINDOW_PASSED_MESSAGE } from '../constants';
import { normalizeAddress } from '../formats/guards';
import { decodeSetupBody } from '../formats/setup-body';
import type { Gathering, Moment, ProofPlace, Reply, Selection } from '../interfaces';
import type { FiledPlace } from '../types/gathering';
import { satisfies, submissionFindings } from '../validation';
import { preferredSet } from './choose';
import { assertGatheringRead, filedPlaces, windowFactsOf } from './edge';

/** The filed place's reply as the proof it submits. */
export const proofOf = (reply: Reply): ProofPlace => ({
  place: reply.place,
  method: normalizeAddress(reply.method, 'method'),
  config: reply.config,
  salt: reply.salt,
  proof: reply.proof,
});

/**
 * The proof places a completion submits, strictly increasing by place: the selection where one is given,
 * otherwise the preferred satisfying set among the filed replies.
 * A selection is taken as given: the preference against stopped methods is not applied to it.
 * Throws where the window has passed at `now`, where the replies or the selection do not satisfy the rule,
 * and where the selection names a place no reply fills.
 */
export function order(record: Gathering, selection: Selection | undefined, now: Moment): ProofPlace[] {
  assertGatheringRead(record);

  if (submissionFindings(windowFactsOf(record), now).errors.length > 0) {
    throw new RangeError(GATHERING_WINDOW_PASSED_MESSAGE);
  }

  const body = decodeSetupBody(record.request.setupBody);
  const filled = filedPlaces(record);

  let chosen: number[];

  if (selection === undefined) {
    const preferred = satisfies(body, filled.keys()) ? preferredSet(body, filled) : undefined;

    if (preferred === undefined) {
      throw new RangeError(GATHERING_RULE_UNSATISFIED_MESSAGE);
    }

    chosen = preferred.map((entry) => entry.entry.place);
  } else {
    chosen = [...new Set(selection)];

    if (!chosen.every((place) => filled.has(place))) {
      throw new RangeError(GATHERING_SELECTION_UNFILLED_MESSAGE);
    }

    if (!satisfies(body, chosen)) {
      throw new RangeError(GATHERING_RULE_UNSATISFIED_MESSAGE);
    }
  }

  return chosen
    .sort((left, right) => left - right)
    .map((place) => proofOf((filled.get(place) as FiledPlace).reply));
}
