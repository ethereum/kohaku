import type { IMerkleFrontier } from '../../utils/merkle-frontier';
import { Secret } from "../../account/keys";
import { Address, Commitment, NullifierHash } from "../../interfaces/types.interface";

interface IBaseEvent {
  blockNumber: bigint;
  transactionHash: bigint;
}

interface IPoolEvent extends IBaseEvent {
  pool: Address;
}

export interface IDepositEvent extends IPoolEvent {
  commitment: Commitment;
  leafIndex: number;
  timestamp: bigint;
}

export interface IIndexedDepositEvent extends IDepositEvent {
  index: number;
  /** Signature-scheme nonce. Set only for signature-derived notes. */
  nonce?: number;
}

export type IIndexedDepositWithSecrets = IIndexedDepositEvent & Secret & (
  | { kind: 'derived'; depositIndex: number }
  | { kind: 'legacy' }
  | { kind: 'signature'; nonce: number }
);

export interface IDepositWithAsset extends IIndexedDepositEvent {
  assetAddress: Address;
}

export interface IDepositWithBalance extends IDepositWithAsset {
  balance: bigint;
}

export interface IWithdrawalEvent extends IPoolEvent {
  to: Address;
  nullifierHash: NullifierHash;
  relayer: Address;
  fee: bigint;
}

export interface IIndexedWithdrawalEvent extends IWithdrawalEvent {
  commitment: Commitment;
}

export type IRawDepositEvent = Omit<IDepositEvent, 'pool'>;
export type IRawWithdrawalEvent = Omit<IWithdrawalEvent, 'pool'>;

export interface IRelayerRegisteredEvent extends IBaseEvent {
  relayer: bigint;
  ensName: string;
  relayerAddress: Address;
  stakedAmount: bigint;
}

export interface IInstanceStateUpdated extends IBaseEvent {
  address: Address;
  state: 0 | 1;
}

export interface IPool {
  address: Address;
  asset: Address;
  isERC20: boolean;
  protocolFeePercentage: number;
  /** Deposit amount for the pool */
  denomination: bigint;
  registeredBlock: bigint;
  state: 0 | 1;
  rootHistorySize: number;
  /**
   * An opt-in ETH pool (0.01, 0.03, 0.3, 3, 30, or Sepolia 10 ETH). Absent on
   * classic pools and on snapshots saved before the field existed.
   */
  extended?: boolean;
  /**
   * Highest block this pool's events have been synced to. Absent until the first
   * sync; syncing resumes from here (falling back to `registeredBlock`). Tracked
   * per-pool because the external sync provider serves data per pool, each with
   * its own coverage.
   */
  lastSyncedBlock?: bigint;
  /**
   * The last block this pool's sync saw finalized. Everything after it may still
   * be reorged away, so each sync drops it and scans it again (see
   * syncEventsThunk). Absent in states saved before it existed, which are
   * rewound once.
   */
  finalizedBlock?: bigint;
  /**
   * The pool's on-chain root at `lastSyncedBlock`, which the stored deposits
   * were checked to rebuild. Lets a withdrawal check its root without
   * rebuilding the tree.
   */
  verifiedRoot?: bigint;
  /**
   * The tree's frontier over the deposits from before `finalizedBlock`, which
   * the next sync keeps. It extends this instead of rebuilding the tree.
   */
  frontier?: IMerkleFrontier;
}

export interface IAsset {
  name: string;
  decimals: number;
  address: Address;
  symbol: string;
}
