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
 * - `random`: an expert-only, throwaway EOA whose private key is discarded.
 *   Every withdrawal pays it before forwarding or running `tailCalls`; failed,
 *   empty, or incomplete execution can permanently strand the net withdrawal.
 *   Any postOp gas refund arrives after forwarding and is also irrecoverable
 *   even when execution succeeds. Do not use in production unless you
 *   deliberately accept those losses and know exactly why this mode is needed.
 */
export type DelegationConfig =
  | { mode: 'deterministic'; path?: string }
  | { mode: 'random' };
