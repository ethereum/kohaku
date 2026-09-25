import type { Finding } from './findings';
import type { Gathering, Reply } from './gathering';

/** Why `addApproverReply` refuses a reply. */
export const ADD_REFUSAL_CAUSES = [
  'kind-or-version-unread',
  'binding-mismatch',
  'digest-mismatch',
  'place-unknown',
  'credential-mismatch',
] as const;

export type AddRefusalCause = (typeof ADD_REFUSAL_CAUSES)[number];

/** A refused filing's reason, shaped like a `ReplyFailure`. */
export type AddRefusal = {
  readonly kind: 'add-refusal';
  readonly cause: AddRefusalCause;
};

/** The outcomes of a filing, which discriminate `AddResult`. */
export const ADD_OUTCOMES = ['filed', 'refused'] as const;

export type AddOutcome = (typeof ADD_OUTCOMES)[number];

/** A filing accepted: a new record with the reply in it. */
export type AddFiled = {
  readonly outcome: 'filed';
  readonly gathering: Gathering;
  /** The reply this one displaced; absent when the place was empty. */
  readonly displaced?: Reply;
};

/** A filing refused, with the record passed in unchanged. */
export type AddRefused = {
  readonly outcome: 'refused';
  readonly gathering: Gathering;
  readonly reason: AddRefusal;
};

/** What `addApproverReply` returns, never a thrown error. */
export type AddResult = AddFiled | AddRefused;

/** One clause's progress toward its threshold. */
export type ClauseCount = {
  readonly clause: number;
  readonly threshold: number;
  readonly filled: number;
};

/** What `assess` returns; it carries no verdict on any proof. */
export type Assessment = {
  /** In ascending order. */
  readonly filled: readonly number[];
  readonly missing: readonly number[];
  readonly clauses: readonly ClauseCount[];
  readonly ruleSatisfied: boolean;
  /** The request findings the counts alone reach. */
  readonly findings: readonly Finding[];
};

/** The set of places the integrator passes to `complete` to override the SDK's choice. */
export type Selection = readonly number[];
