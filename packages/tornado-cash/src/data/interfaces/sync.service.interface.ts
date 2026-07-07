import { ExternalRawEvent, ExternalSyncPoolId } from "@kohaku-eth/plugins";
import { Hex } from "ox/Hex";
import { Address } from "../../interfaces/types.interface";
import { IDataService } from "./data.service.interface";
import {
  IRawDepositEvent,
  IRawWithdrawalEvent,
  IRelayerRegisteredEvent,
} from "./events.interface";

/**
 * Worker-facing view of the host's `ExternalSyncProvider`. The host exposes a
 * streaming provider (`streamEvents` returning an async iterator), but async
 * iterators cannot cross the Comlink worker boundary. The plugin adapts the
 * provider into this materialized-array shape on the main thread before proxying
 * it into the state-manager worker (see `plugin/base.ts`).
 */
export type ExternalSyncClient = {
  getEvents(
    params: ExternalSyncPoolId & { fromBlock: Hex; toBlock: Hex },
  ): Promise<ExternalRawEvent[]>;
  /** @throws if the provider has no data for the pool. */
  firstCoveredBlock(params: ExternalSyncPoolId): Promise<Hex>;
  /** @throws if the provider has no data for the pool. */
  lastCoveredBlock(params: ExternalSyncPoolId): Promise<Hex>;
};

export interface SyncServiceParams {
  dataService: IDataService;
  externalSyncProvider?: ExternalSyncClient;
  /**
   * Minimum number of blocks a pool must be behind before the external provider
   * is used. Below this, or when no provider is configured, events are fetched
   * from the chain as usual.
   */
  minExternalSyncBlocksAmount?: number;
}

/** Identifies one contract to sync from a given block. */
export interface IGetEventsParams {
  chainId: bigint;
  address: Address;
  fromBlock: bigint;
}

/** Alias kept for readability at pool call sites. */
export type IGetPoolEventsParams = IGetEventsParams;

export interface IGetPoolEventsResult {
  Deposited: IRawDepositEvent[];
  Withdrawn: IRawWithdrawalEvent[];
  /** Highest block the returned events are synced up to. */
  toBlock: bigint;
}

export interface IGetRelayerRegistryEventsResult {
  RelayerRegistered: IRelayerRegisteredEvent[];
  /** Highest block the returned events are synced up to. */
  toBlock: bigint;
}

export interface ISyncService {
  /**
   * Fetches a single pool's `Deposited`/`Withdrawn` events from `fromBlock`.
   * Uses the external sync provider for the bulk of a large range and the chain
   * for the remaining tail; falls back to a chain-only fetch otherwise.
   */
  getPoolEvents(params: IGetEventsParams): Promise<IGetPoolEventsResult>;

  /**
   * Fetches the relayer registry's `RelayerRegistered` events from `fromBlock`,
   * with the same external-then-chain strategy as {@link getPoolEvents}.
   */
  getRelayerRegistryEvents(
    params: IGetEventsParams,
  ): Promise<IGetRelayerRegistryEventsResult>;

  /**
   * Resolves a pool's scan-start block. Uses the external provider's first
   * covered block when available (an O(1) lookup), else falls back to the
   * on-chain deployment-block binary search.
   */
  getPoolDeploymentBlock(params: { chainId: bigint; address: Address }): Promise<bigint>;
}
