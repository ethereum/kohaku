/* eslint-disable max-lines */
import { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import {
  GetEventsFn,
  IDataService,
  IEntrypointEvents,
  IPoolConfig,
  IPoolEvents,
  IPoolEventsWithLogMeta,
} from "./interfaces/data.service.interface";
import { parseEventLogs, pad, toHex, type RpcLog, type Hex } from "viem";
import {
  ENTRYPOINT_EVENTS_SIGNATURES,
  EVENTS_SIGNATURES,
  POOL_EVENTS_SIGNATURES,
} from "./abis/events.abi";
import { EVENTS_PARSERS } from "./utils/events-parsers.util";
import { EthClient, GetLogsParams } from "./eth-client";
import type { IAsset } from "./interfaces/events.interface";
import { Address } from "../interfaces/types.interface";
import { E_ADDRESS } from "../config";

const txLogToRpcLog = ({
  address,
  data,
  topics,
  blockNumber,
  logIndex,
}: TxLog): RpcLog => ({
  address: address as Hex,
  data: data as Hex,
  topics: topics as [Hex, ...Hex[]],
  transactionHash: '0x0',
  transactionIndex: '0x0',
  blockHash: '0x0',
  blockNumber: toHex(blockNumber),
  blockTimestamp: '0x0',
  logIndex: logIndex === undefined ? null : toHex(logIndex),
  removed: false,
});

export interface DataServiceParams {
  provider: EthereumProvider;
  /**
   * Optional override for event-log fetching. Lets a test (or an alternative
   * hydration source such as saga-sync) supply logs without changing how the
   * rest of the service reads chain state via the provider. Defaults to the
   * provider-backed `EthClient.getLogs`.
   */
  getLogs?: (params: GetLogsParams) => Promise<TxLog[]>;
}

const depositEvents = new Set(["PoolDeposited", "EntrypointDeposited"]);

type EventName = keyof typeof EVENTS_SIGNATURES;

const parseLogs = <const T extends EventName>(logs: RpcLog[], events: T | T[]) => {
  const allEvents = events instanceof Array ? events : [events];

  return allEvents.reduce(
    (parsedEvents, eventType) => ({
      ...parsedEvents,
      [eventType]: parseEventLogs({
        logs,
        abi: [EVENTS_SIGNATURES[eventType]] as const,
        eventName: (depositEvents.has(eventType)
          ? "Deposited"
          : eventType) as never,
        strict: true,
      } as const).map((parsedLog) => ({
        ...EVENTS_PARSERS[eventType](parsedLog as never),
        ...(parsedLog.logIndex !== null ? { logIndex: parsedLog.logIndex } : {}),
      })),
    }),
    {} as Record<T, unknown[]>,
  );
};

type GenericGetEvents = GetEventsFn<
  typeof EVENTS_SIGNATURES,
  IPoolEvents & IEntrypointEvents
>;

export class DataService implements IDataService {
  private readonly ethClient!: EthClient;
  private readonly getLogs: (params: GetLogsParams) => Promise<TxLog[]>;

  constructor({ provider, getLogs }: DataServiceParams) {
    this.ethClient = new EthClient(provider);
    this.getLogs = getLogs ?? ((params) => this.ethClient.getLogs(params));
  }

  private getEvents: GenericGetEvents = async ({
    events,
    address,
    fromBlock,
    toBlock,
  }) => {

    const logs = await this.getLogs({
      address: pad(toHex(address), { size: 20 }),
      fromBlock,
      ...(toBlock ? { toBlock } : {}),
    });

    return {
      ...parseLogs(logs.map(txLogToRpcLog), events),
      fromBlock: fromBlock,
      toBlock: BigInt(logs.at(-1)?.blockNumber || 0n) || fromBlock,
    } as Awaited<ReturnType<GenericGetEvents>>;
  };

  getPoolEvents: GetEventsFn<typeof POOL_EVENTS_SIGNATURES, IPoolEvents> =
    this.getEvents;
  getEntrypointEvents: GetEventsFn<
    typeof ENTRYPOINT_EVENTS_SIGNATURES,
    IEntrypointEvents
  > = this.getEvents;

  async getAsset(address: Address): Promise<IAsset> {
    if (address === BigInt(E_ADDRESS)) {
      return {
        name: "ETH",
        address,
        decimals: 18,
        symbol: "ETH",
      };
    }

    const [name, decimals, symbol] = await Promise.all([
      this.ethClient.makeContractRequest(address, "erc20", "name"),
      this.ethClient.makeContractRequest(address, "erc20", "decimals"),
      this.ethClient.makeContractRequest(address, "erc20", "symbol"),
    ]);

    return { name, decimals, symbol, address };
  }

  async getPoolAsset(poolAddress: Address) {
    return BigInt(
      await this.ethClient.makeContractRequest(poolAddress, "pool", "ASSET"),
    );
  }

  async getPoolForAsset(
    entrypointAddress: Address,
    assetAddress: Address,
  ): Promise<IPoolConfig> {
    const [poolAddress, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] =
      await this.ethClient.makeContractRequest(
        entrypointAddress,
        "entrypoint",
        "assetConfig",
        toHex(assetAddress),
      );

    return {
      poolAddress: BigInt(poolAddress),
      minimumDepositAmount,
      vettingFeeBPS,
      maxRelayFeeBPS,
    };
  }

  async getPoolScope(poolAddress: Address) {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "SCOPE");
  }

  async getChainId() {

    const chainIdHex = await this.ethClient.request({
      method: "eth_chainId",
      params: [],
    }) as string;

    return BigInt(chainIdHex);
  }

  async getPoolStateRoot(poolAddress: Address): Promise<bigint> {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "currentRoot");
  }

  async getPoolCurrentRootIndex(poolAddress: Address): Promise<number> {
    return Number(
      await this.ethClient.makeContractRequest(poolAddress, "pool", "currentRootIndex")
    );
  }

  async getPoolHistoricalRoot(poolAddress: Address, index: number): Promise<bigint> {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "roots", BigInt(index));
  }

  async getEntrypointLatestRoot(entrypointAddress: Address): Promise<bigint> {
    return this.ethClient.makeContractRequest(entrypointAddress, "entrypoint", "latestRoot");
  }

  async getEntrypointRootByIndex(entrypointAddress: Address, index: number): Promise<bigint> {
    return this.ethClient.makeContractRequest(entrypointAddress, "entrypoint", "rootByIndex", BigInt(index));
  }

  async quoteWeiInToken(
    paymasterAddress: Address,
    feeToken: Address,
    weiAmount: bigint,
  ): Promise<bigint> {
    return this.ethClient.makeContractRequest(
      paymasterAddress,
      "paymaster",
      "quoteWeiInToken",
      toHex(feeToken, { size: 20 }),
      weiAmount,
    );
  }

  async getLatestBlockTimestamp(): Promise<bigint> {
    return this.getBlockTimestamp("latest");
  }

  async getBlockTimestamp(blockNumber: bigint | "latest"): Promise<bigint> {
    const block = await this.ethClient.request({
      method: "eth_getBlockByNumber",
      params: [typeof blockNumber === "bigint" ? toHex(blockNumber) : blockNumber, false],
    }) as { timestamp?: string } | null;

    if (!block?.timestamp) {
      throw new Error(`Failed to fetch block ${blockNumber} timestamp`);
    }

    return BigInt(block.timestamp);
  }

  async getPoolEventsAtBlock(poolAddress: Address, blockNumber: bigint): Promise<IPoolEventsWithLogMeta> {
    // Always straight from the RPC: unlike `getLogs` (which may be saga-backed),
    // these logs carry the real transactionHash and logIndex.
    const logs = await this.ethClient.request({
      method: "eth_getLogs",
      params: [{
        address: pad(toHex(poolAddress), { size: 20 }),
        fromBlock: toHex(blockNumber),
        toBlock: toHex(blockNumber),
      }],
    }) as RpcLog[];

    return parseLogs(logs, ["PoolDeposited", "Withdrawn", "Ragequit"]) as IPoolEventsWithLogMeta;
  }
}
