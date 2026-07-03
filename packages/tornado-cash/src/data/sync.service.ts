import { ExternalRawEvent } from "@kohaku-eth/plugins";
import { toHex } from "viem";
import {
  ExternalSyncClient,
  IGetEventsParams,
  IGetPoolEventsResult,
  IGetRelayerRegistryEventsResult,
  ISyncService,
  SyncServiceParams,
} from "./interfaces/sync.service.interface";
import { IDataService } from "./interfaces/data.service.interface";

/**
 * Orchestrates event fetching for a contract, choosing between the host-supplied
 * external sync provider (fast, for large ranges) and the chain (via
 * {@link IDataService}). Parsing and chain access stay in the DataService — this
 * service only decides the source and streams from the external provider.
 */
export class SyncService implements ISyncService {
  private readonly dataService: IDataService;
  private readonly externalSyncProvider?: ExternalSyncClient;
  private readonly minExternalSyncBlocksAmount?: number;

  constructor({
    dataService,
    externalSyncProvider,
    minExternalSyncBlocksAmount,
  }: SyncServiceParams) {
    this.dataService = dataService;
    this.externalSyncProvider = externalSyncProvider;
    this.minExternalSyncBlocksAmount = minExternalSyncBlocksAmount;
  }

  async getPoolEvents({
    chainId,
    address,
    fromBlock,
  }: IGetEventsParams): Promise<IGetPoolEventsResult> {
    const head = await this.dataService.getBlockNumber();

    const external = await this.maybeFetchExternalRaw({ chainId, address, fromBlock, head });

    if (!external) {
      // Chain-only: below the threshold, no provider, or no external coverage.
      const { Deposited, Withdrawn, toBlock } = await this.dataService.getPoolEvents({
        events: ["Deposited", "Withdrawn"],
        address,
        fromBlock,
      });

      return { Deposited, Withdrawn, toBlock };
    }

    const { Deposited, Withdrawn } = this.dataService.parsePoolEvents(external.rawEvents);

    // The chain takes over from the block right after the provider's coverage.
    const tail = await this.dataService.getPoolEvents({
      events: ["Deposited", "Withdrawn"],
      address,
      fromBlock: external.coverage + 1n,
    });

    return {
      Deposited: [...Deposited, ...tail.Deposited],
      Withdrawn: [...Withdrawn, ...tail.Withdrawn],
      toBlock: head,
    };
  }

  async getRelayerRegistryEvents({
    chainId,
    address,
    fromBlock,
  }: IGetEventsParams): Promise<IGetRelayerRegistryEventsResult> {
    const head = await this.dataService.getBlockNumber();

    const external = await this.maybeFetchExternalRaw({ chainId, address, fromBlock, head });

    if (!external) {
      const { RelayerRegistered, toBlock } = await this.dataService.getRelayerRegistryEvents({
        events: "RelayerRegistered",
        address,
        fromBlock,
      });

      return { RelayerRegistered, toBlock };
    }

    const { RelayerRegistered } = this.dataService.parseRelayerRegistryEvents(external.rawEvents);

    const tail = await this.dataService.getRelayerRegistryEvents({
      events: "RelayerRegistered",
      address,
      fromBlock: external.coverage + 1n,
    });

    return {
      RelayerRegistered: [...RelayerRegistered, ...tail.RelayerRegistered],
      toBlock: head,
    };
  }

  /**
   * Decides whether to use the external provider and, if so, streams its raw
   * events for `[fromBlock, coverage]`. Event-agnostic: callers parse the raw
   * events with the appropriate DataService method. Returns `null` to signal a
   * chain-only fetch (below threshold, no provider, or no coverage).
   */
  private async maybeFetchExternalRaw({
    chainId: rawChainId,
    address,
    fromBlock,
    head,
  }: IGetEventsParams & { head: bigint }): Promise<
    { rawEvents: ExternalRawEvent[]; coverage: bigint } | null
  > {
    const provider = this.externalSyncProvider;
    const min = this.minExternalSyncBlocksAmount;

    if (!provider || min == null || head - fromBlock < BigInt(min)) {
      return null;
    }

    const chainId = toHex(rawChainId);
    const hexAddress = toHex(address, { size: 20 });
    const rawCoverage = await provider.lastCoveredBlock({ chainId, address: hexAddress });

    if (!rawCoverage) {
      return null;
    }

    const coverage = BigInt(rawCoverage);

    if (coverage <= fromBlock) {
      return null;
    }

    const toBlock = coverage < head ? coverage : head;

    const rawEvents = await provider.getEvents({
      chainId,
      address: hexAddress,
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    });

    return { rawEvents, coverage: toBlock };
  }
}
