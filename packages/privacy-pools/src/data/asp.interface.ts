import { Network } from "@kohaku-eth/plugins";

import { Address, AspReviewStatus, Precommitment } from "../interfaces/types.interface";
import { RootState } from "../state";

// TODO: This is a very basic limiting, non-exhaustive ASP interface; we can refactor later
export interface IAspService {
  /** `signal` aborts once the sync stops waiting for the tree. */
  getAspTree(state: RootState, signal?: AbortSignal): Promise<bigint[][]>;
}

export interface IAspServiceParams {
  network: Network;
}

/** The review outcomes that keep a deposit out of the ASP tree. */
export type AspFlaggedStatus = Exclude<AspReviewStatus, 'pending' | 'approved'>;

export interface IAspFlaggedDeposit {
  precommitment: Precommitment;
  pool: Address;
  status: AspFlaggedStatus;
}

/**
 * Tells which deposits the ASP declined or asked a proof of innocence for. The
 * service is untrusted: its answers only label deposits that are not in the ASP
 * tree, they never approve one.
 */
export interface IAspReviewService {
  /**
   * Every flagged deposit of the chain, not only the user's, so the service can't learn which are ours.
   * `signal` aborts once the sync stops waiting for the answer.
   */
  getFlaggedDeposits(params: { chainId: bigint; signal?: AbortSignal }): Promise<IAspFlaggedDeposit[]>;
}
