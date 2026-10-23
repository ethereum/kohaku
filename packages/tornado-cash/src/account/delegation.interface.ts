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
 * How the batch delegator for a tail-call paymaster withdrawal is produced.
 * Only honored when `tailCalls` are present (see `paymasterWithdrawThunk`).
 *
 * - `deterministic` (default): recoverable. With `path`, the delegator is a
 *   classical wallet-path address; without `path`, an ephemeral address keyed by
 *   the batch's first deposit.
 * - `random`: a throwaway, unrecoverable EOA — an explicit opt-out of
 *   recoverability. Never the default, because in the tail-call path the
 *   delegator holds the withdrawn funds.
 */
export type DelegationConfig =
  | { mode: 'deterministic'; path?: string }
  | { mode: 'random' };
