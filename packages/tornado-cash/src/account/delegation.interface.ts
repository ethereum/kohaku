import type { LocalAccount } from 'viem/accounts';

/**
 * The subset of a signing account the paymaster withdrawal flow needs from the
 * batch delegator.
 *
 * In the EIP-7702 Simple7702 design the delegator *is* the userOp sender, so it
 * must sign both the 7702 authorization and the userOp hash — not merely the
 * authorization. A viem `LocalAccount` satisfies this structurally (so
 * `privateKeyToAccount` adapts in one line), and a host-supplied hardware/remote
 * signer can satisfy it too. This is the injection seam consumed by
 * `buildSignedTornadoUserOp`.
 */
export type DelegatorAccount = Pick<LocalAccount, 'address' | 'signTypedData'> & {
  // `signAuthorization` is optional on `LocalAccount`; the delegator must have it.
  signAuthorization: NonNullable<LocalAccount['signAuthorization']>;
};

/**
 * How the paymaster withdrawal sender is produced. Honored for every sponsored
 * withdrawal, including a single note without user-supplied `tailCalls`.
 *
 * - `deterministic` (default): recoverable. With `path`, the delegator is a
 *   classical wallet-path address; without `path`, an ephemeral address keyed by
 *   the batch's first deposit.
 * - `random`: SAFE ONLY FOR A SINGLE-NOTE WITHDRAWAL WITH NO `tailCalls`.
 *   That direct-payout path uses `callGasLimit = 0` and sends both the withdrawal
 *   and its gas refund to the requested recipient, never to the throwaway sender.
 *   UNSAFE FOR ALL MULTI-NOTE WITHDRAWALS AND ANY WITHDRAWAL WITH `tailCalls`,
 *   even a callback returning no calls. Those paths pay the sender in validation;
 *   an execution failure can strand the principal, and the later postOp refund
 *   can remain there even after successful forwarding. The random private key
 *   is discarded, so these funds are permanently inaccessible. Successful gas
 *   estimation does NOT make random delegation safe for those paths. Use a
 *   securely recoverable deterministic or external signer instead.
 * - `external`: an explicitly selected host signer. Its key stays on the host;
 *   only scoped signing requests and verified signatures cross the worker bridge.
 *   Successful estimation and final simulation are required even with best-effort policy.
 */
export type DelegationConfig =
  | { mode: 'deterministic'; path?: string }
  | {
    /**
     * SAFE ONLY for exactly one note with `tailCalls` omitted.
     * NEVER use for multi-note withdrawals or any `tailCalls`: the discarded
     * sender key makes stranded principal and gas refunds permanently inaccessible.
     */
    mode: 'random';
  }
  | { mode: 'external'; signer: DelegatorAccount };

/** Plain-data representation sent to the worker; callbacks use a separate port. */
export type WorkerDelegationConfig = Exclude<DelegationConfig, { mode: 'external' }> |
  { mode: 'external'; address: DelegatorAccount['address'] };
