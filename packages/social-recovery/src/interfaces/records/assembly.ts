// What the gathering operations of D-207 return over a record: the add result,
// the assessment and the selection `complete` takes. Line numbers are
// design/offchain/sdk.md.
import type { Finding } from './findings';
import type { Gathering, Reply } from './gathering';

/**
 * The five refusals of the filing and no sixth (D-207 l.1538; owner ruling
 * cut-q-22): a kind or version it does not read, six binding fields that do not
 * match, a digest that is not this gathering's for that place, a place the map
 * does not name, and a method, config or salt that is not exactly the place's.
 */
export const ADD_REFUSAL_CAUSES = [
  'kind-or-version-unread',
  'binding-mismatch',
  'digest-mismatch',
  'place-unknown',
  'credential-mismatch',
] as const;

export type AddRefusalCause = (typeof ADD_REFUSAL_CAUSES)[number];

/** A refusal of the filing, of the same shape as the reply failure of D-206 (D-207 l.1538). */
export type AddRefusal = {
  readonly kind: 'add-refusal';
  readonly cause: AddRefusalCause;
};

/** The two outcomes of a filing, the literal `AddResult` is discriminated by (D-207 l.1538). */
export const ADD_OUTCOMES = ['filed', 'refused'] as const;

export type AddOutcome = (typeof ADD_OUTCOMES)[number];

/** A filing accepted: a new record with the reply in it (D-207 l.1538, usage l.489). */
export type AddFiled = {
  readonly outcome: 'filed';
  readonly gathering: Gathering;
  /** The reply this one displaced; absent when the place was empty. */
  readonly displaced?: Reply;
};

/** A filing refused: the record passed in, unchanged, beside the `reason` (D-207 l.1538). */
export type AddRefused = {
  readonly outcome: 'refused';
  readonly gathering: Gathering;
  readonly reason: AddRefusal;
};

/** What `addApproverReply` returns, never a thrown error (D-207 l.1538, usage l.489). */
export type AddResult = AddFiled | AddRefused;

/** One clause's threshold beside its filled count (D-207 l.1539, usage l.493). */
export type ClauseCount = {
  readonly clause: number;
  readonly threshold: number;
  readonly filled: number;
};

/** What `assess` returns; it carries no verdict on any proof (D-207 l.1539, usage l.492-493). */
export type Assessment = {
  /** In ascending order. */
  readonly filled: readonly number[];
  readonly missing: readonly number[];
  readonly clauses: readonly ClauseCount[];
  readonly ruleSatisfied: boolean;
  /** The four request codes of D-205 the assessment's own arithmetic reaches. */
  readonly findings: readonly Finding[];
};

/** The set of places the integrator passes to `complete` to override the SDK's choice (D-207 l.1540). */
export type Selection = readonly number[];
