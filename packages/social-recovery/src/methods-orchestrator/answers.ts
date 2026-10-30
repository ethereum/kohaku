import {
  FORMATS_HEX_BYTES_PATTERN,
  GATHERING_REPLY_KIND,
  GATHERING_REPLY_VERSION,
  METHODS_ORCHESTRATOR_BYTES_ANSWER_MESSAGE,
  METHODS_ORCHESTRATOR_ENROLL_ANSWER_MESSAGE,
  METHODS_ORCHESTRATOR_ENROLL_KINDS,
  METHODS_ORCHESTRATOR_INPUT_ANSWER_MESSAGE,
  METHODS_ORCHESTRATOR_VERDICT_ANSWER_MESSAGE,
} from '../constants';
import { isRecord, lowerHex } from '../formats/guards';
import {
  REPLY_FAILURE_CAUSES,
  REPLY_FAILURE_KIND,
  VERDICTS,
  type Ctx,
  type EnrollInput,
  type Hex,
  type Input,
  type Reply,
  type ReplyFailure,
  type ReplyFailureCause,
  type Verdict,
} from '../interfaces';

/** A fresh frozen failure built from the cause read once, or undefined where the answer is not a typed failure with a known cause. */
function failureOf(value: unknown): ReplyFailure | undefined {
  if (!isRecord(value)) return undefined;

  const kind = value['kind'];
  const cause = value['cause'];

  if (kind !== REPLY_FAILURE_KIND || !(REPLY_FAILURE_CAUSES as readonly unknown[]).includes(cause)) return undefined;

  return Object.freeze({ kind: REPLY_FAILURE_KIND, cause: cause as ReplyFailureCause });
}

/** The implementation's verdict, refusing any other answer with a `TypeError` naming the member. */
export function checkedVerdict(answer: unknown, member: string): Verdict {
  if (!(VERDICTS as readonly unknown[]).includes(answer)) throw new TypeError(`${member} ${METHODS_ORCHESTRATOR_VERDICT_ANSWER_MESSAGE}`);

  return answer as Verdict;
}

/** The implementation's bytes lower-cased, or a fresh copy of its typed failure; any other answer is a `TypeError` naming the member. */
export function checkedBytes(answer: unknown, member: string): Hex | ReplyFailure {
  if (typeof answer === 'string' && FORMATS_HEX_BYTES_PATTERN.test(answer)) return lowerHex(answer as Hex);

  const failure = failureOf(answer);

  if (failure !== undefined) return failure;

  throw new TypeError(`${member} ${METHODS_ORCHESTRATOR_BYTES_ANSWER_MESSAGE}`);
}

/** The implementation's signing input, refusing a non-object, an array or a promise with a `TypeError` naming the member. */
export function checkedInput(answer: unknown, member: string): Input {
  if (!isRecord(answer) || typeof answer['then'] === 'function') throw new TypeError(`${member} ${METHODS_ORCHESTRATOR_INPUT_ANSWER_MESSAGE}`);

  return answer;
}

/** The implementation's enrollment input, refusing an answer of neither enrollment kind with a `TypeError` naming the member. */
export function checkedEnrollInput(answer: unknown, member: string): EnrollInput {
  if (!isRecord(answer) || !METHODS_ORCHESTRATOR_ENROLL_KINDS.includes(answer['kind'] as string)) {
    throw new TypeError(`${member} ${METHODS_ORCHESTRATOR_ENROLL_ANSWER_MESSAGE}`);
  }

  return answer as EnrollInput;
}

/** The reply carrying the proof, its fields named one by one from the checked request the ctx holds. */
export function replyOf(ctx: Ctx, proof: Hex): Reply {
  const { request } = ctx;

  return Object.freeze({
    kind: GATHERING_REPLY_KIND,
    version: GATHERING_REPLY_VERSION,
    chainId: request.chainId,
    manager: request.manager,
    account: request.account,
    action: request.action,
    attemptId: request.attemptId,
    purpose: request.purpose,
    place: ctx.place,
    method: request.method,
    config: request.config,
    salt: request.salt,
    digest: lowerHex(ctx.digest),
    proof,
  });
}
