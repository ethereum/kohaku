import { ChainId } from "@kohaku-eth/plugins";
import { ParseAbiItem } from "viem";
import { Address } from "../../interfaces/types.interface";
import {
  RELAYER_REGISTRY_EVENTS_SIGNATURES,
  POOL_EVENTS_SIGNATURES,
  INSTANCE_REGISTRY_EVENT_SIGNATURES,
} from "../abis/events.abi";
import {
  IAsset,
  IRelayerRegisteredEvent,
  IRawDepositEvent,
  IRawWithdrawalEvent,
  IInstanceStateUpdated,
} from "./events.interface";

type IEventsMap = Record<string, ParseAbiItem<string>>;

export interface IGetEventsParams<T> {
  events: T | T[];
  fromBlock: bigint;
  toBlock?: bigint;
  address: bigint;
}

export interface IRelayerRegistryEvents {
  RelayerRegistered: IRelayerRegisteredEvent;
}

export interface IPoolEvents {
  Deposited: IRawDepositEvent;
  Withdrawn: IRawWithdrawalEvent;
}

export interface IInstanceRegistryEvents {
  InstanceStateUpdated: IInstanceStateUpdated;
}

type IGroupedEvents<NamesTable extends Record<string, unknown>> = {
  [key in keyof NamesTable]: NamesTable[key][];
};

export type GetEventsFn<
  EventsMap extends IEventsMap,
  ParsedEvents extends { [key in keyof EventsMap]: unknown },
> = <const T extends keyof ParsedEvents = never>(
  params: IGetEventsParams<T>,
) => Promise<
  Pick<IGroupedEvents<ParsedEvents>, T> & {
    fromBlock: bigint;
    toBlock: bigint;
  }
>;

export interface IPoolConfig {
  poolAddress: Address;
  isERC20: boolean;
  token: Address;
  state: 0 | 1;
  uniswapPoolSwappingFee: number;
  protocolFeePercentage: number;
  denomination: bigint;
  rootHistorySize: number;
}

export interface IRelayerAggregatorData {
  owner: Address;
  balance: bigint;
  isRegistered: boolean;
  records: string[];
}

export interface IDataService {
  getPoolEvents: GetEventsFn<typeof POOL_EVENTS_SIGNATURES, IPoolEvents>;
  getRelayerRegistryEvents: GetEventsFn<
    typeof RELAYER_REGISTRY_EVENTS_SIGNATURES,
    IRelayerRegistryEvents
  >;
  getInstanceRegistryEvents: GetEventsFn<
    typeof INSTANCE_REGISTRY_EVENT_SIGNATURES,
    IInstanceRegistryEvents
  >;
  getAsset(assetAddress: Address): Promise<IAsset>;
  getAllPoolsAddresses(registryAddress: Address): Promise<Address[]>;
  getPoolAsset(poolAddress: Address): Promise<Address>;
  getPoolConfig(registryAddress: Address, poolAddress: Address): Promise<IPoolConfig>;
  getChainId(): Promise<ChainId>;

  getContractDeploymentBlock(address: Address, fromBlock?: bigint): Promise<bigint>;
  getPoolStateRoot(poolAddress: Address): Promise<bigint>;
  getPoolCurrentRootIndex(poolAddress: Address): Promise<number>;
  isPoolRootValid(poolAddress: Address, root: bigint): Promise<boolean>;
  getPoolHistoricalRoot(poolAddress: Address, index: number): Promise<bigint>;
  getLatestBlockTimestamp(): Promise<bigint>;
  getRelayerData(
    aggregatorAddress: Address,
    relayerNameHashes: bigint[],
    subdomains: string[],
  ): Promise<IRelayerAggregatorData[]>;
}
