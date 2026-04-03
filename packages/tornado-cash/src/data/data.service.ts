import { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import {
  GetEventsFn,
  IDataService,
  IRelayerRegistryEvents,
  IPoolConfig,
  IPoolEvents,
  IInstanceRegistryEvents,
} from "./interfaces/data.service.interface";
import { parseEventLogs, pad, toHex, type RpcLog, type Hex, hexToBigInt } from "viem";
import {
  RELAYER_REGISTRY_EVENTS_SIGNATURES,
  EVENTS_SIGNATURES,
  POOL_EVENTS_SIGNATURES,
  InstanceRegistryEventTypes,
} from "./abis/events.abi";
import { EVENTS_PARSERS } from "./utils/events-parsers.util";
import { EthClient } from "./eth-client";
import type { IAsset } from "./interfaces/events.interface";
import { Address } from "../interfaces/types.interface";
import { E_ADDRESS } from "../config";

const txLogToRpcLog = ({
  address,
  data,
  topics,
  blockNumber
}: TxLog, index = 0): RpcLog => ({
  address: address as Hex,
  data: data as Hex,
  topics: topics as [Hex, ...Hex[]],
  transactionHash: '0x0',
  transactionIndex: '0x0',
  blockHash: '0x0',
  blockNumber: toHex(blockNumber),
  logIndex: `0x${index}` as const,
  removed: false,
});

export interface DataServiceParams {
  provider: EthereumProvider;
}

const depositEvents = new Set(["PoolDeposited", "EntrypointDeposited"]);

type GenericGetEvents = GetEventsFn<
  typeof EVENTS_SIGNATURES,
  IPoolEvents & IRelayerRegistryEvents & InstanceRegistryEventTypes
>;

export class DataService implements IDataService {
  private readonly ethClient!: EthClient;

  constructor({ provider }: DataServiceParams) {
    this.ethClient = new EthClient(provider);
  }

  private getEvents: GenericGetEvents = async ({
    events,
    address,
    fromBlock,
    toBlock,
  }) => {

    const logs = await this.ethClient.getLogs({
      address: pad(toHex(address), { size: 20 }),
      fromBlock,
      ...(toBlock ? { toBlock } : {}),
    });
    const allEvents = events instanceof Array ? events : [events];

    return allEvents.reduce(
      (parsedEvents, eventType) => ({
        ...parsedEvents,
        [eventType]: parseEventLogs({
          logs: logs.map(txLogToRpcLog),
          abi: [EVENTS_SIGNATURES[eventType]] as const,
          eventName: (depositEvents.has(eventType)
            ? "Deposited"
            : eventType) as never,
          strict: true,
        } as const).map((parsedLog) =>
          EVENTS_PARSERS[eventType](parsedLog as never),
        ),
      }),
      {
        fromBlock: fromBlock,
        toBlock: BigInt(logs.at(-1)?.blockNumber || 0n) || fromBlock,
      } satisfies Pick<
        Awaited<ReturnType<GenericGetEvents>>,
        "fromBlock" | "toBlock"
      >,
    ) as Awaited<ReturnType<GenericGetEvents>>;
  };

  getPoolEvents: GetEventsFn<typeof POOL_EVENTS_SIGNATURES, IPoolEvents> =
    this.getEvents;

  getRelayerRegistryEvents: GetEventsFn<
    typeof RELAYER_REGISTRY_EVENTS_SIGNATURES,
    IRelayerRegistryEvents
  > = this.getEvents;

  getInstanceRegistryEvents = this.getEvents;

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

  getAllPoolsAddresses(registryAddress: Address): Promise<Address[]> {
    return this.ethClient.makeContractRequest(registryAddress, 'instanceRegistry', 'getAllInstanceAddresses')
      .then((addresses) => addresses.map(BigInt))
  }

  async getPoolAsset(poolAddress: Address) {
    return this.ethClient.makeContractRequest(poolAddress, "instanceRegistry", "getPoolToken", poolAddress).then(hexToBigInt)
  }

  async getPoolConfig(
    registryAddress: Address,
    poolAddress: Address,
  ): Promise<IPoolConfig> {
    const [[isERC20, token, state, uniswapPoolSwappingFee, protocolFeePercentage], denomination] =
    await Promise.all([
      this.ethClient.makeContractRequest(
        registryAddress,
        'instanceRegistry',
        'instances',
        toHex(poolAddress, { size: 20 })
      ),
      await this.ethClient.makeContractRequest(poolAddress, 'pool', 'denomination'),
    ]);

    return {
      poolAddress,
      isERC20,
      token: BigInt(token),
      state: state as 0 | 1,
      uniswapPoolSwappingFee,
      protocolFeePercentage,
      denomination
    };
  }

  async getChainId() {

    const chainIdHex = await this.ethClient.request({
      method: "eth_chainId",
      params: [],
    }) as string;

    return BigInt(chainIdHex);
  }

  async getPoolStateRoot(poolAddress: Address): Promise<bigint> {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "getLastRoot").then(hexToBigInt);
  }

  async getPoolCurrentRootIndex(poolAddress: Address): Promise<number> {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "currentRootIndex")
  }

  async getPoolHistoricalRoot(poolAddress: Address, index: number): Promise<bigint> {
    return this.ethClient.makeContractRequest(poolAddress, "pool", "roots", BigInt(index)).then(hexToBigInt);
  }

  async getLatestBlockTimestamp(): Promise<bigint> {
    const block = await this.ethClient.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }) as { timestamp?: string } | null;

    if (!block?.timestamp) {
      throw new Error("Failed to fetch latest block timestamp");
    }

    return BigInt(block.timestamp);
  }
}
