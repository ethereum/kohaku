import { GATHERING_SELECTION_UNFILLED_MESSAGE } from '../constants';
import { normalizeAddress } from '../formats/guards';
import { decodeSetupBody } from '../formats/setup-body';
import type { Gathering, Moment, ProofPlace, Reply, Selection } from '../interfaces';
import type { FiledPlace, OrderRefusal, OrderVerdict } from '../types/gathering';
import { submissionFindings } from '../validation';
import { emptyFindings } from '../validation/common';
import { ruleCountFindings } from '../validation/request-proofs';
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

/** The filled places' proofs, strictly increasing by place. */
const proofsAt = (places: readonly number[], filled: ReadonlyMap<number, FiledPlace>): ProofPlace[] =>
  [...places].sort((left, right) => left - right).map((place) => proofOf((filled.get(place) as FiledPlace).reply));

/**
 * The ordering's verdict at `now`: the proofs a completion submits, strictly increasing by place (the selection where one is
 * given, taken as given, otherwise the preferred satisfying set), or the refusal with its findings: the whole window result
 * where the window has passed, the rule's findings where a filed or selected place lies past the rule's credential count or
 * the replies or the selection do not satisfy the rule. Only the chosen replies are read as proofs.
 * Throws where the record is unread and where the selection names a place no reply fills.
 */
export function orderVerdict(record: Gathering, selection: Selection | undefined, now: Moment): OrderVerdict {
  assertGatheringRead(record);

  const window = submissionFindings(windowFactsOf(record), now);

  if (window.errors.length > 0) return { outcome: 'refused', reason: 'window-passed', findings: window };

  const body = decodeSetupBody(record.request.setupBody);
  const filled = filedPlaces(record);
  const places = selection === undefined ? [...filled.keys()] : [...new Set(selection)];

  if (!places.every((place) => filled.has(place))) throw new RangeError(GATHERING_SELECTION_UNFILLED_MESSAGE);

  const findings = emptyFindings();
  const ascending = [...places].sort((left, right) => left - right);

  ruleCountFindings({ body, proofs: ascending.map((place) => ({ place })) }, findings);

  if (findings.errors.length > 0) {
    const outOfRange = findings.errors.some(({ code }) => code === 'proof.place-out-of-range');
    const reason: OrderRefusal = outOfRange ? 'place-out-of-range' : 'rule-unsatisfied';

    return { outcome: 'refused', reason, findings };
  }

  if (selection !== undefined) return { outcome: 'ordered', proofs: proofsAt(places, filled) };

  const preferred = preferredSet(body, filled);

  if (preferred === undefined) return { outcome: 'refused', reason: 'rule-unsatisfied', findings };

  return { outcome: 'ordered', proofs: proofsAt(preferred.map((entry) => entry.entry.place), filled) };
}
