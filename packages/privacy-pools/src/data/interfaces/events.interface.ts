import { Address, Commitment, Label, Nullifier, Precommitment } from "../../interfaces/types.interface";

interface IBaseEvent {
  blockNumber: bigint;
  transactionHash: bigint;
}

interface IPoolEvent extends IBaseEvent {
  pool: Address;
}

export interface IPoolDepositEvent extends IPoolEvent {
  depositor: Address;
  commitment: Commitment;
  label: Label;
  precommitment: Precommitment;
  value: bigint;
}

export interface IIndexedDepositEvent extends IPoolDepositEvent {
  index: number;
  approved: boolean;
}

export interface IDepositWithAsset extends IIndexedDepositEvent {
  assetAddress: Address;
}

export interface IDepositWithBalance extends IDepositWithAsset {
  balance: bigint;
}

export interface IWithdrawalEvent extends IPoolEvent {
  spentNullifier: Nullifier;
  commitment: Commitment;
  value: bigint;
}

export interface IIndexedWithdrawalEvent extends IWithdrawalEvent {
  index: number;
  label: Label;
}

export interface IRagequitEvent extends IPoolEvent {
  ragequitter: Address;
  commitment: Commitment;
  label: Label;
  value: bigint;
}

export type IRawPoolDepositEvent = Omit<IPoolDepositEvent, 'pool'>;
export type IRawWithdrawalEvent = Omit<IWithdrawalEvent, 'pool'>;
export type IRawRagequitEvent = Omit<IRagequitEvent, 'pool'>;

export interface IEntrypointDepositEvent extends IBaseEvent {
  depositor: Address;
  poolAddress: Address;
  commitment: Commitment;
}

export interface IRootUpdatedEvent extends IBaseEvent {
  root: bigint;
  ipfsCID: string;
  timestamp: bigint;
}

export interface IPoolRegisteredEvent extends IBaseEvent {
  pool: Address;
  asset: Address;
  scope: bigint;
}

export interface IPoolWindDownEvent extends IBaseEvent {
  pool: Address;
}

export interface ILeafInsertedEvent extends IBaseEvent {
  index: bigint;
  commitment: Commitment;
  root: bigint;
}

export interface IPool {
  address: Address;
  asset: Address;
  scope: bigint;
  registeredBlock: bigint;
  woundDownAtBlock: bigint | null;
}

export interface IAsset {
  name: string;
  decimals: number;
  address: Address;
  symbol: string;
}
