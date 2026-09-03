import type { LocalAccount } from "viem/accounts";

/**
 * The subset of a signing account the paymaster withdrawal flow needs. In the
 * EIP-7702 Simple7702 design the ephemeral sender *is* the userOp sender, so it
 * must sign both the 7702 authorization and the userOp hash. A viem
 * `LocalAccount` (via `privateKeyToAccount`) satisfies this structurally.
 */
export type DelegatorAccount = Pick<LocalAccount, "address" | "signTypedData"> & {
  signAuthorization: NonNullable<LocalAccount["signAuthorization"]>;
};

/**
 * How the ephemeral sender for a paymaster withdrawal is produced.
 *
 * - `deterministic` (default): recoverable — keyed by the withdrawn note's
 *   deposit index via the SecretManager, so a stuck sender can be swept.
 * - `random`: a throwaway, unrecoverable EOA. Safe here because in the
 *   single-note flow the funds go straight to the recipient during paymaster
 *   validation and never sit in the sender.
 */
export type DelegationConfig = { mode: "deterministic" } | { mode: "random" };

export interface SerializedAuth {
  address: `0x${string}`;
  chainId: `0x${string}`;
  nonce: `0x${string}`;
  r: `0x${string}`;
  s: `0x${string}`;
  yParity: `0x${string}`;
}

/**
 * A userOp serialized to the hex shape expected by `eth_sendUserOperation`, so
 * it can be carried as plain (JSON-serializable) data from the prepare phase
 * (thunk) to the broadcast phase.
 */
export interface SerializedUserOperation {
  sender: `0x${string}`;
  nonce: `0x${string}`;
  callData: `0x${string}`;
  callGasLimit: `0x${string}`;
  verificationGasLimit: `0x${string}`;
  preVerificationGas: `0x${string}`;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
  paymaster?: `0x${string}`;
  paymasterVerificationGasLimit?: `0x${string}`;
  paymasterPostOpGasLimit?: `0x${string}`;
  paymasterData?: `0x${string}`;
  signature: `0x${string}`;
  eip7702Auth?: SerializedAuth;
}

export interface UserOpGasLimits {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

export interface BuildSignedUserOpParams {
  /** The ephemeral account that becomes the userOp sender; signs the 7702 auth and the userOp hash. */
  signer: DelegatorAccount;
  chainId: number;
  paymasterAddress: `0x${string}`;
  paymasterData: `0x${string}`;
  gas: UserOpGasLimits;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** EntryPoint nonce for this sender. Defaults to 0 (fresh single-use EOA). */
  nonce?: bigint;
}
