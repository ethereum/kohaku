import type { Address, Hex } from './chain';
import type { PaymentOrder } from './manager';

/** One filled place of a submission. */
export type ProofPlace = {
  readonly place: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt: Hex;
  readonly proof: Hex;
};

/** An opening submission, `startAttempt(request)`. */
export type AttemptRequest = {
  readonly account: Address;
  readonly action: Address;
  /** The exact next attempt id. */
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  /** The revealed setup body. */
  readonly setupBody: Hex;
  readonly payload: Hex;
  readonly order: PaymentOrder;
  readonly validUntil: number;
  /** Strictly increasing by place. */
  readonly proofs: readonly ProofPlace[];
};

/** A cancellation submission, `cancelByProofs(request)`. */
export type CancelRequest = {
  readonly account: Address;
  readonly action: Address;
  /** The live attempt id. */
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBody: Hex;
  readonly validUntil: number;
  readonly proofs: readonly ProofPlace[];
};
