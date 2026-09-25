import type { Address, Hex } from './chain';

/** The acts a proof signs. */
export const PURPOSES = ['approval', 'cancellation'] as const;

export type Purpose = (typeof PURPOSES)[number];

/** A payment order inside a gathering record, its amount as a decimal string. */
export type SerializedPaymentOrder = {
  readonly token: Address;
  readonly amount: string;
  readonly payee: Address;
};

/** Whether the credential's config address holds code, recorded at init so a method's `verify` reads no chain. */
type CredentialCodeStatus = {
  readonly credentialHoldsCode: boolean;
};

/** The members every request of one gathering shares. */
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
} & CredentialCodeStatus;

/** The request one approver receives, carrying their own credential alone and no label. */
export type ApproverRequest = ApproverRequestMembers &
  (
    | { readonly purpose: 'approval'; readonly payload: Hex; readonly order: SerializedPaymentOrder }
    | { readonly purpose: 'cancellation' }
  );

/** The reply one approver sends back. */
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

/** The block the init pinned, its timestamp as a decimal string. */
export type GatheringBlock = {
  readonly number: number;
  readonly timestamp: string;
  readonly hash: Hex;
};

/** The request members every digest of a gathering closes over, with the pinned block. */
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

/** A method's pause standing, read once at init. */
export const STANDINGS = ['stopped', 'not-stopped'] as const;

export type Standing = (typeof STANDINGS)[number];

/** One entry of the place map, always whole and in body order. */
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
} & CredentialCodeStatus;

/**
 * The record the assembling wallet holds, storing only what cannot be recomputed.
 * Values that can exceed a JavaScript number travel as decimal strings.
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
