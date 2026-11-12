import type { TxData } from "@kohaku-eth/provider";
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
 * - `deterministic` (default): recoverable. Without `path`, an ephemeral sender
 *   keyed by the withdrawn note (deposit/withdraw index) via the SecretManager —
 *   recoverable by re-derivation, but not a wallet-visible address. With `path`,
 *   a classical BIP-32 wallet-path key derived WITHOUT the privacy transform, so
 *   it resolves to a recoverable, wallet-native address a stuck sender can be
 *   swept from with standard tooling.
 * - `random`: an expert-only, throwaway EOA. Its private key is discarded and
 *   cannot be recovered. A single-note withdrawal without `tailCalls` pays the
 *   recipient during validation, but `batch` or `tailCalls` pays this sender
 *   first. Failed, empty, or incomplete execution can leave the net withdrawal
 *   permanently inaccessible. Do not use in production unless you deliberately
 *   accept that risk and know exactly why this mode is needed.
 * - `external`: a host-held EOA implementing the two signing callbacks below.
 *   The SDK never asks the SecretManager for its private key. Returned signatures
 *   are verified, authorization is cached per preparation, and bundler estimation
 *   must succeed. Note-secret discovery/proving is unchanged.
 */
export type DelegationConfig = (
  | { mode: "deterministic"; path?: string }
  | { mode: "random" }
  | { mode: "external"; signer: DelegatorAccount }) & {
    /** Compatible external v0.8 implementation; defaults to Simple7702. */
    implementation?: `0x${string}`;
    /** Optional assertion of the current EntryPoint nonce (key 0 when omitted). */
    nonce?: bigint;
    /** Allow used sender state. Defaults to true for external and wallet-path EOAs, false otherwise. */
    allowUsed?: boolean;
  } | SmartAccountDelegation;

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
  factory?: `0x${string}`;
  factoryData?: `0x${string}`;
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
  executionAccount?: ExecutionAccountConfig;
  chainId: number;
  paymasterAddress: `0x${string}`;
  paymasterData: `0x${string}`;
  gas: UserOpGasLimits;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** EntryPoint nonce for this sender. Defaults to 0 (fresh single-use EOA). */
  nonce?: bigint;
  /**
   * EOA transaction-count nonce the EIP-7702 authorization binds to. Defaults to
   * `nonce` (0 for a fresh single-use sender). A reused wallet-path delegator has
   * a nonzero transaction count, so the authorization must bind to its real nonce
   * or the bundler rejects it — this is distinct from the EntryPoint `nonce` above.
   */
  authorizationNonce?: bigint;
  /**
   * Optional execution-phase calls run by the Simple7702 sender after the
   * withdrawal (which pays the sender during validation). Empty → callData `0x`;
   * one call → `execute`; many → `executeBatch`.
   */
  tailCalls?: (sender: `0x${string}`) => Promise<TxData[]>;
}

/** EOA owner of a v0.8 account; no authorization capability is required. */
export type TypedDataSigner = Pick<LocalAccount, 'address' | 'signTypedData'>;

/** Restricted to the eth-infinitism v0.8 execute/executeBatch ABI and EIP-712
 * owner signature. Custom 7702 implementations must preserve these semantics. */
export type ExecutionAccountConfig =
  | { kind: 'eip7702'; implementation?: `0x${string}` }
  | { kind: 'simple-account'; address: `0x${string}`;
      /** Omit for an already deployed account. Address must match factory.getAddress(owner, salt). */
      factory?: { address: `0x${string}`; salt: bigint } };

export type SmartAccountDelegation = {
  mode: 'smart-account';
  signer: TypedDataSigner;
  account: Extract<ExecutionAccountConfig, { kind: 'simple-account' }>;
  /** Optional assertion of EntryPoint getNonce(account, key); default reads key 0. */
  nonce?: bigint;
  /** Explicit opt-in to a deployed, delegated, funded or previously used sender. */
  allowUsed?: boolean;
};
