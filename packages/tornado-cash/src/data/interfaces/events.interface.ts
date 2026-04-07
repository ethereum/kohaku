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
}

export type IIndexedDepositWithSecrets = IIndexedDepositEvent & Secret;

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
  uniswapPoolSwappingFee: number;
  protocolFeePercentage: number;
  /** Deposit amount for the pool */
  denomination: bigint;
  registeredBlock: bigint;
  state: 0 | 1;
}

export interface IAsset {
  name: string;
  decimals: number;
  address: Address;
  symbol: string;
}
