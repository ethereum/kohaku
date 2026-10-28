import { fileReply, type AttemptRequest, type CancelRequest, type Gathering, type ProofPlace, type Reply } from '../../src/index';
import { approvalGathering, cancellationGathering, replyFor } from '../gathering/support';

/** A gathering with replies filed at the given places, in order. */
export function filedAt(start: Gathering, places: readonly number[]): Gathering {
  return places.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}`);

    return result.gathering;
  }, start);
}

/** The blessed two-clause approval gathering (place 0, and two of places 1..3) with replies at the places given. */
export const approvalWith = (places: readonly number[]): Gathering => filedAt(approvalGathering(), places);

/** The blessed two-clause cancellation gathering with replies at the places given. */
export const cancellationWith = (places: readonly number[]): Gathering => filedAt(cancellationGathering(), places);

/** A reply as the proof it submits, addresses and bytes lower-cased for comparison. */
export const proofOfReply = (reply: Reply): ProofPlace => ({
  place: reply.place,
  method: reply.method.toLowerCase() as ProofPlace['method'],
  config: reply.config.toLowerCase() as ProofPlace['config'],
  salt: reply.salt.toLowerCase() as ProofPlace['salt'],
  proof: reply.proof.toLowerCase() as ProofPlace['proof'],
});

/** A submitted proof lower-cased for comparison. */
export const loweredProof = (proof: ProofPlace): ProofPlace => ({
  place: proof.place,
  method: proof.method.toLowerCase() as ProofPlace['method'],
  config: proof.config.toLowerCase() as ProofPlace['config'],
  salt: proof.salt.toLowerCase() as ProofPlace['salt'],
  proof: proof.proof.toLowerCase() as ProofPlace['proof'],
});

/** The request members a completion must carry, read off the record by hand; proofs left out. */
export function expectedMembers(record: Gathering): Omit<AttemptRequest, 'proofs'> | Omit<CancelRequest, 'proofs'> {
  const r = record.request;
  const shared = {
    account: r.account.toLowerCase(),
    action: r.action.toLowerCase(),
    attemptId: BigInt(r.attemptId),
    setupNonce: BigInt(r.setupNonce),
    setupBody: r.setupBody.toLowerCase(),
    validUntil: Number(r.validUntil),
  };

  if (record.purpose === 'cancellation') return shared as Omit<CancelRequest, 'proofs'>;

  const { order, payload } = record.request;

  return {
    ...shared,
    payload: payload.toLowerCase(),
    order: { token: order.token.toLowerCase(), amount: BigInt(order.amount), payee: order.payee.toLowerCase() },
  } as Omit<AttemptRequest, 'proofs'>;
}

/** A completion's members lower-cased, proofs left out, for comparison with `expectedMembers`. */
export function loweredMembers(request: AttemptRequest | CancelRequest): Record<string, unknown> {
  const lowered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(request)) {
    if (key === 'proofs') continue;

    if (typeof value === 'string') lowered[key] = value.toLowerCase();
    else if (key === 'order' && typeof value === 'object' && value !== null) {
      const order = value as AttemptRequest['order'];

      lowered[key] = { token: order.token.toLowerCase(), amount: order.amount, payee: order.payee.toLowerCase() };
    } else lowered[key] = value;
  }

  return lowered;
}
