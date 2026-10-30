import { GATHERING_ORDER_REFUSAL_MESSAGES } from '../constants';
import type { Gathering, Moment, ProofPlace, Selection } from '../interfaces';
import { orderVerdict } from './verdict';

export { proofOf } from './verdict';

/**
 * The proof places a completion submits, strictly increasing by place: the selection where one is given,
 * otherwise the preferred satisfying set among the filed replies.
 * A selection is taken as given: the preference against stopped methods is not applied to it.
 * Throws where the window has passed at `now`, where the replies or the selection do not satisfy the rule or a place lies
 * past the rule's count, and where the selection names a place no reply fills.
 */
export function order(record: Gathering, selection: Selection | undefined, now: Moment): ProofPlace[] {
  const verdict = orderVerdict(record, selection, now);

  if (verdict.outcome === 'refused') throw new RangeError(GATHERING_ORDER_REFUSAL_MESSAGES[verdict.reason]);

  return [...verdict.proofs];
}
