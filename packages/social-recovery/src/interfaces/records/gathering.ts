// The three gathering records of D-207, versioned rather than frozen. Every
// value that can exceed a JavaScript number travels as a decimal string, the
// place as a number (D-207 l.1489). Line numbers are design/offchain/sdk.md.
import type { Address, Hex } from './chain';

/** Approval or cancellation, the two acts a proof signs (D-205 l.1129, D-207 l.1494). */
export const PURPOSES = ['approval', 'cancellation'] as const;

export type Purpose = (typeof PURPOSES)[number];

/** A payment order inside a gathering record, its amount as a decimal string (D-207 l.1489, l.1498). */
export type SerializedPaymentOrder = {
  readonly token: Address;
  readonly amount: string;
  readonly payee: Address;
};

/** The members every request of one gathering shares (D-207 l.1494-1500, l.1503). */
type ApproverRequestMembers = {
  readonly kind: 'recovery-proof-request';
  /** This kind's version; a reader refuses one it does not read. */
  readonly version: number;
  readonly chainId: string;
  readonly manager: Address;
  readonly digestVersion: string;
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: string;
  readonly setupNonce: string;
  readonly setupBodyHash: Hex;
  readonly validUntil: string;
  readonly place: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt: Hex;
};

/**
 * The request one approver receives, carrying their own credential alone and
 * no label; a cancellation carries no payload and no order (D-207 l.1491-1503).
 * Named `ApproverRequest` so it never reads as the DOM's `Request`.
 */
export type ApproverRequest = ApproverRequestMembers &
  (
    | { readonly purpose: 'approval'; readonly payload: Hex; readonly order: SerializedPaymentOrder }
    | { readonly purpose: 'cancellation' }
  );

/** The reply one approver sends back (D-207 l.1505-1514). */
export type Reply = {
  readonly kind: 'recovery-proof-reply';
  readonly version: number;
  readonly chainId: string;
  readonly manager: Address;
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: string;
  readonly purpose: Purpose;
  readonly place: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt: Hex;
  readonly digest: Hex;
  readonly proof: Hex;
};

/** The block the init pinned, its timestamp as a decimal string (D-207 l.1523, l.1529). */
export type GatheringBlock = {
  readonly number: number;
  readonly timestamp: string;
  readonly hash: Hex;
};

/** The request block's members every digest closes over, the written-out body and the pinned block (D-207 l.1520-1523, l.1529). */
type GatheringRequestMembers = {
  readonly chainId: string;
  readonly manager: Address;
  readonly digestVersion: string;
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: string;
  readonly setupNonce: string;
  readonly setupBody: Hex;
  readonly validUntil: string;
  readonly block: GatheringBlock;
};

/** A method's stop under D-111's two-valued rule, read once at init (D-207 l.1525, l.1529). */
export const STANDINGS = ['stopped', 'not-stopped'] as const;

export type Standing = (typeof STANDINGS)[number];

/** One entry of the place map, always whole and in body order (D-207 l.1524-1525, l.1529). */
export type GatheringPlace = {
  readonly place: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt: Hex;
  /** The integrator's own, never in a request. */
  readonly label?: string;
  readonly standing: Standing;
  /** Whether the method carries a pause at all, from a nonzero `pauseHolder`. */
  readonly stoppable: boolean;
};

/**
 * The record the assembling wallet holds, storing only what cannot be
 * recomputed; a cancellation's request block carries the attempt's
 * `consumableAfter` and no payload or order (D-207 l.1516-1529).
 */
export type Gathering = {
  readonly kind: 'gathering';
  readonly version: number;
  readonly places: readonly GatheringPlace[];
  readonly replies: readonly Reply[];
} & (
  | {
      readonly purpose: 'approval';
      readonly request: GatheringRequestMembers & {
        readonly payload: Hex;
        readonly order: SerializedPaymentOrder;
      };
    }
  | {
      readonly purpose: 'cancellation';
      readonly request: GatheringRequestMembers & { readonly consumableAfter: string };
    }
);
