// The calldata structs of D-103 the SDK encodes for a prepared call
// (D-204 l.883-892, design/onchain/contracts.md l.445-480). Widths: uint48 as
// number, uint64 as bigint, a place as number (D-207 l.1489).
import type { Address, Hex } from './chain';
import type { PaymentOrder } from './manager';

/** One filled place: place, method, config, salt and proof (D-204 l.889, contracts.md l.461-467). */
export type ProofPlace = {
  readonly place: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt: Hex;
  readonly proof: Hex;
};

/** An opening submission, `startAttempt(request)` (D-204 l.887, contracts.md l.445-455). */
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

/** A cancellation submission, `cancelByProofs(request)`: no payload and no order (D-204 l.888, contracts.md l.472-480). */
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
