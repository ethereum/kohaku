import type { KitError } from './abi';
import type { Address, Hex, PinnedBlock } from './chain';

/** The option every prepare but `prepareCancelByOwner` takes. */
export type PrepareOptions = {
  /** Defaults to the client configuration's simulation default. */
  readonly simulate?: boolean;
  /** The address a permissionless call's simulation runs from. */
  readonly from?: Address;
};

/** Who the target accepts the call from. */
export const SENDERS = ['account', 'anyone'] as const;

export type Sender = (typeof SENDERS)[number];

/** A prepared call's simulation outcome. */
export type SimulationResult =
  | { readonly success: true }
  | { readonly success: false; readonly from: Address; readonly error: KitError };

/** One call of the batch the action will run, a description and never something to sign. */
export type DescribedCall = {
  readonly target: Address;
  readonly value: bigint;
  readonly data: Hex;
};

/** One unsigned call, with its simulation. */
export type PreparedCall = {
  readonly kind: 'call';
  /** The manager, the account or the action contract. */
  readonly target: Address;
  /** Zero for every call the SDK prepares. */
  readonly value: bigint;
  readonly data: Hex;
  readonly sender: Sender;
  readonly block: PinnedBlock;
  /** Absent when the integrator skipped the simulation. */
  readonly simulation?: SimulationResult;
  /** Absent on every call but `prepareExecuteHandover`'s. */
  readonly describes?: readonly DescribedCall[];
};

/** Prepared calls sent as one transaction, each simulated at the block the batch pinned. */
export type PreparedBatch = {
  readonly kind: 'batch';
  readonly calls: readonly PreparedCall[];
  readonly atomic: boolean;
  readonly block: PinnedBlock;
};
