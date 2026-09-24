// The request description and the status description (D-205 l.1119-1147).
// Line numbers are design/offchain/sdk.md.
import type { Address, Hex } from './chain';
import type { Purpose } from './gathering';
import type { AttemptState, PaymentOrder } from './manager';
import type { DeviceFacts } from './methods';
import type { KitNotification } from './notifications';

/** The two keys decoded from the payload and re-encoded back to it, or the fact it could not be (l.1130). */
export type DescribedHandover =
  | { readonly decoded: true; readonly newAuthority: Address; readonly removedAuthority: Address }
  | { readonly decoded: false; readonly cause: 'no-codec' | 'round-trip-failed' };

/** Token and amount, the payee named or open (l.1131). */
export type DescribedOrder = {
  readonly token: Address;
  readonly amount: bigint;
  readonly payee: Address | 'open';
};

/** What an approver reads before producing a proof, computed with no chain read (l.1119-1137). */
export type RequestDescription = {
  readonly account: Address;
  readonly chainId: number;
  readonly manager: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly purpose: Purpose;
  /** Absent on a cancellation. */
  readonly handover?: DescribedHandover;
  /** Absent on a cancellation. */
  readonly order?: DescribedOrder;
  readonly validUntil: number;
  readonly place: number;
  /** The method, config and salt a submission publishes on chain (l.1134). */
  readonly identityPublic: { readonly method: Address; readonly config: Hex; readonly salt: Hex };
  /** The implementation's facts, or that no registered implementation serves the method (l.1135). */
  readonly device: DeviceFacts | 'no-implementation';
};

/** A stop going on or coming off. */
export type MethodStopNotification = Extract<KitNotification, { readonly kind: 'method-paused' | 'method-unpaused' }>;

/** The attempt as a status screen shows it (l.1144). */
export type StatusAttempt = {
  readonly state: AttemptState;
  readonly attemptId: bigint;
  /** Raw, beside the pinned block's timestamp for the screen's own clock to judge. */
  readonly consumableAfter: number;
  readonly blockTimestamp: number;
  readonly usedMethods: readonly Address[];
  /** From the latest opening event, absent where the notifications passed hold none. */
  readonly usedPlaces?: readonly bigint[];
  readonly ignoresPause: boolean;
  /** From the latest opening event, as bytes, absent where the notifications passed hold none. */
  readonly payload?: Hex;
  readonly order: PaymentOrder;
};

/** The two state records and the latest notifications, composed with no read (l.1139-1147). */
export type StatusDescription = {
  /** The hash both records carry, or that they carry different ones (l.1143). */
  readonly block:
    | { readonly sameBlock: true; readonly hash: Hex }
    | { readonly sameBlock: false; readonly setupHash: Hex; readonly recoveryHash: Hex };
  /** Absent where there is no attempt. */
  readonly attempt?: StatusAttempt;
  /** From the setup record's `isAuthorized` (l.1145). */
  readonly armed: boolean;
  readonly setup: {
    readonly setupCommitment: Hex;
    readonly setupNonce: bigint;
    readonly setupCommittedAtBlock: number;
  };
  /** Per method the attempt used, the latest notification of its stop (l.1147). */
  readonly stops: readonly { readonly method: Address; readonly latest?: MethodStopNotification }[];
};
