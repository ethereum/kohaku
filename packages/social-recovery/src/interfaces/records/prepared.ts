// The two records every write comes back as (D-202 l.547-562).
// Line numbers are design/offchain/sdk.md.
import type { KitError } from './abi';
import type { Address, Hex, PinnedBlock } from './chain';

/** The option every prepare but `prepareCancelByOwner` takes (D-201 l.101, D-202 l.572, l.575). */
export type PrepareOptions = {
  /** Defaults to the client configuration's simulation default. */
  readonly simulate?: boolean;
  /** The address a permissionless call's simulation runs from. */
  readonly from?: Address;
};

/** The caller the target accepts a call from, two values rather than an address (D-202 l.557, l.566). */
export const SENDERS = ['account', 'anyone'] as const;

export type Sender = (typeof SENDERS)[number];

/** Success, or a typed error with the address the simulation ran from (D-202 l.559, l.576, usage l.496). */
export type SimulationResult =
  | { readonly success: true }
  | { readonly success: false; readonly from: Address; readonly error: KitError };

/** One call of the batch the action will run, a description and never something to sign (D-202 l.560, l.632). */
export type DescribedCall = {
  readonly target: Address;
  readonly value: bigint;
  readonly data: Hex;
};

/** A target, a value, calldata and the caller, unsigned, with its simulation (D-200 l.16, D-202 l.551-560). */
export type PreparedCall = {
  readonly kind: 'call';
  /** The manager, the account or the action contract. */
  readonly target: Address;
  /** Zero for every call D-202 prepares. */
  readonly value: bigint;
  readonly data: Hex;
  readonly sender: Sender;
  readonly block: PinnedBlock;
  /** Absent when the integrator skipped the simulation. */
  readonly simulation?: SimulationResult;
  /** Absent on every call but the execute. */
  readonly describes?: readonly DescribedCall[];
};

/** Prepared calls that are one transaction, each with its own simulation at the one block the batch pinned (D-202 l.562). */
export type PreparedBatch = {
  readonly kind: 'batch';
  readonly calls: readonly PreparedCall[];
  readonly atomic: boolean;
  readonly block: PinnedBlock;
};
