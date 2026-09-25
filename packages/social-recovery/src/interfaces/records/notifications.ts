import type { Address, Hex, LogPosition } from './chain';
import type { PaymentOrder } from './manager';

/** The per-account filter's options; `allActions` leaves the action topic open. */
export type AccountFilterOptions = {
  readonly allActions?: boolean;
};

/** The manager function that cancelled an attempt, as far as one log can tell. */
export const CANCELLED_BY = ['cancelByOwner', 'cancelByProofs', 'cancelByVeto', 'setupWrite'] as const;

export type CancelledBy = (typeof CANCELLED_BY)[number];

/** The notification kinds, one per event the SDK decodes. */
export const NOTIFICATION_KINDS = [
  'setup-committed',
  'setup-cleared',
  'attempt-started',
  'attempt-cancelled',
  'attempt-consumed',
  'method-paused',
  'method-unpaused',
  'method-keys-updated',
  'method-admin-renounced',
  'method-admin-transfer-offered',
  'method-admin-transferred',
  'method-pause-holder-transfer-started',
  'method-pause-holder-transferred',
  'privilege-changed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One decoded log, its values and its position, never a sentence. */
export type KitNotification =
  | {
      readonly kind: 'setup-committed';
      readonly account: Address;
      readonly action: Address;
      readonly nonce: bigint;
      readonly setupCommitment: Hex;
      readonly publicMetadata: Hex;
      readonly privateMetadata: Hex;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'setup-cleared';
      readonly account: Address;
      readonly action: Address;
      readonly nonce: bigint;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'attempt-started';
      readonly account: Address;
      readonly action: Address;
      readonly attemptId: bigint;
      readonly setupNonce: bigint;
      readonly setupBody: Hex;
      readonly usedPlaces: readonly bigint[];
      readonly usedMethods: readonly Address[];
      readonly payload: Hex;
      readonly order: PaymentOrder;
      readonly consumableAfter: number;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'attempt-cancelled';
      readonly account: Address;
      readonly action: Address;
      readonly attemptId: bigint;
      readonly canceller: Address;
      readonly vetoingMethod: Address;
      /** Derived rather than decoded. */
      readonly cancelledBy: CancelledBy;
      readonly setupNonce: bigint;
      readonly usedPlaces: readonly bigint[];
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'attempt-consumed';
      readonly account: Address;
      readonly action: Address;
      readonly attemptId: bigint;
      readonly at: LogPosition;
    }
  | { readonly kind: 'method-paused'; readonly method: Address; readonly by: Address; readonly at: LogPosition }
  | { readonly kind: 'method-unpaused'; readonly method: Address; readonly by: Address; readonly at: LogPosition }
  | {
      readonly kind: 'method-keys-updated';
      readonly method: Address;
      readonly previous: readonly Hex[];
      readonly current: readonly Hex[];
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'method-admin-renounced';
      readonly method: Address;
      readonly previous: Address;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'method-admin-transfer-offered';
      readonly method: Address;
      readonly current: Address;
      readonly pending: Address;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'method-admin-transferred';
      readonly method: Address;
      readonly previous: Address;
      readonly current: Address;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'method-pause-holder-transfer-started';
      readonly method: Address;
      readonly previous: Address;
      readonly pending: Address;
      readonly at: LogPosition;
    }
  | {
      readonly kind: 'method-pause-holder-transferred';
      readonly method: Address;
      readonly previous: Address;
      readonly current: Address;
      readonly at: LogPosition;
    }
  | {
      /** The account's own `LogPrivilegeChanged`. */
      readonly kind: 'privilege-changed';
      readonly account: Address;
      readonly addr: Address;
      readonly priv: Hex;
      readonly at: LogPosition;
    };
