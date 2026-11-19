/* eslint-disable max-lines */
import { ExternalRawEvent } from "@kohaku-eth/plugins";
import { toHex } from "viem";
import { Address } from "../interfaces/types.interface";
import {
  ExternalSyncClient,
  IGetEventsParams,
  IGetPoolEventsParams,
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

  async getPoolEvents({ address, ...params }: IGetPoolEventsParams): Promise<IGetPoolEventsResult> {
    const { segments, toBlock, external } = await this.fetchSegments(
      { address, ...params },
      (range) => this.dataService.getPoolEvents({ events: ["Deposited", "Withdrawn"], address, ...range }),
      (rawEvents) => this.dataService.parsePoolEvents(rawEvents),
    );

    return {
      Deposited: segments.flatMap((segment) => segment.Deposited),
      Withdrawn: segments.flatMap((segment) => segment.Withdrawn),
      toBlock,
      external,
    };
  }

  async getRelayerRegistryEvents({ address, ...params }: IGetEventsParams): Promise<IGetRelayerRegistryEventsResult> {
    const { segments, toBlock } = await this.fetchSegments(
      { address, ...params },
      (range) => this.dataService.getRelayerRegistryEvents({ events: "RelayerRegistered", address, ...range }),
      (rawEvents) => this.dataService.parseRelayerRegistryEvents(rawEvents),
    );

    return {
      RelayerRegistered: segments.flatMap((segment) => segment.RelayerRegistered),
      toBlock,
    };
  }

  async getPoolDeploymentBlock({
    chainId,
    address,
  }: {
    chainId: bigint;
    address: Address;
  }): Promise<bigint> {
    const provider = this.externalSyncProvider;

    if (provider) {
      let hint: bigint | undefined;

      try {
        // The provider's first covered block ≈ the pool's registration block, at
        // O(1) — much cheaper than the on-chain deployment-block binary search.
        hint = BigInt(
          await provider.firstCoveredBlock({
            chainId: toHex(chainId),
            address: toHex(address, { size: 20 }),
          }),
        );
      } catch {
        // Provider has no data for this pool — fall through to on-chain discovery.
      }

      if (hint !== undefined && await this.isScanLowerBound(address, hint)) {
        return hint;
      }
    }

    return this.dataService.getContractDeploymentBlock(address);
  }

  /**
   * The scan start is persisted and never revisited, so a provider hint is only
   * trusted when it cannot skip history: it is not past the head, and the pool
   * had no code in the block before it (so no events can precede it).
   */
  private async isScanLowerBound(address: Address, block: bigint): Promise<boolean> {
    if (block < 0n || block > await this.dataService.getBlockNumber()) {
      return false;
    }

    return block === 0n || !(await this.dataService.isContractDeployedAt(address, block - 1n));
  }

  /**
   * Fetches events from `fromBlock` as ascending segments: chain-only, or a
   * chain backfill before the provider's first covered block, the provider's
   * events, and the chain tail after its coverage. Chain queries use the same
   * captured head so a later head read cannot advance the scan's cursor.
   */
  private async fetchSegments<T>(
    params: IGetPoolEventsParams,
    fetchChain: (range: { fromBlock: bigint; toBlock?: bigint }) => Promise<T & { toBlock: bigint }>,
    parseExternal: (rawEvents: ExternalRawEvent[]) => T,
  ): Promise<{ segments: T[]; toBlock: bigint; external: boolean }> {
    const head = await this.dataService.getBlockNumber();
    const external = params.chainOnly ? null : await this.maybeFetchExternalRaw({ ...params, head });

    if (!external) {
      // Chain-only: asked for, below the threshold, no provider, or no external coverage.
      const chain = await fetchChain({ fromBlock: params.fromBlock, toBlock: head });

      return { segments: [chain], toBlock: chain.toBlock, external: false };
    }

    const segments: T[] = [];

    if (external.firstCovered > params.fromBlock) {
      segments.push(await fetchChain({ fromBlock: params.fromBlock, toBlock: external.firstCovered - 1n }));
    }

    segments.push(parseExternal(external.rawEvents));

    // The chain takes over from the block right after the provider's coverage.
    const tail = await fetchChain({ fromBlock: external.coverage + 1n, toBlock: head });

    segments.push(tail);

    return { segments, toBlock: tail.toBlock, external: true };
  }

  /**
   * Decides whether to use the external provider and, if so, streams its raw
   * events for `[max(fromBlock, firstCovered), coverage]`. Event-agnostic:
   * callers parse the raw events with the appropriate DataService method, and
   * backfill `[fromBlock, firstCovered - 1]` from the chain when the provider's
   * data starts later. Returns `null` to signal a chain-only fetch (below
   * threshold, no provider, or no coverage).
   */
  private async maybeFetchExternalRaw({
    chainId: rawChainId,
    address,
    fromBlock,
    head,
  }: IGetEventsParams & { head: bigint }): Promise<
    { rawEvents: ExternalRawEvent[]; firstCovered: bigint; coverage: bigint } | null
  > {
    const provider = this.externalSyncProvider;
    const min = this.minExternalSyncBlocksAmount;

    if (!provider || min == null || head - fromBlock < BigInt(min)) {
      return null;
    }

    const chainId = toHex(rawChainId);
    const hexAddress = toHex(address, { size: 20 });

    let firstCovered: bigint;
    let coverage: bigint;

    try {
      [firstCovered, coverage] = await Promise.all([
        provider.firstCoveredBlock({ chainId, address: hexAddress }).then(BigInt),
        provider.lastCoveredBlock({ chainId, address: hexAddress }).then(BigInt),
      ]);
    } catch {
      // Provider has no data for this pool (or failed) — fall back to chain-only.
      return null;
    }

    const toBlock = coverage < head ? coverage : head;

    if (coverage <= fromBlock || firstCovered > toBlock) {
      return null;
    }

    const rawEvents = await provider.getEvents({
      chainId,
      address: hexAddress,
      fromBlock: toHex(firstCovered > fromBlock ? firstCovered : fromBlock),
      toBlock: toHex(toBlock),
    });

    return { rawEvents, firstCovered, coverage: toBlock };
  }
}
