import type { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import { ContractFunctionName, decodeFunctionResult, DecodeFunctionResultReturnType, encodeFunctionData, EncodeFunctionDataParameters, erc20Abi, toHex } from 'viem';
import { Address } from "../interfaces/types.interface";
import { aggregatorAbi } from "./abis/aggregator.abi";
import { instanceRegistryAbi } from "./abis/instance-registry.abi";
import { poolAbi } from "./abis/pool.abi";

export interface GetLogsParams {
    address: string;
    fromBlock: bigint;
    toBlock?: bigint;
    maxQuerySize?: bigint;
}

const abis = {
    erc20: erc20Abi,
    pool: poolAbi,
    instanceRegistry: instanceRegistryAbi,
    aggregator: aggregatorAbi,
} as const;

export class EthClient {
    constructor(
        private provider: EthereumProvider
    ) {}

    request: EthereumProvider['request'] = (...params): Promise<unknown> => {
        return this.provider.request(...params);
    }

    async getChainId() {
        return this.provider.getChainId();
    }

    async getLogs({
        maxQuerySize = 5000n,
        ...params
    }: GetLogsParams): Promise<TxLog[]> {
        const fromBlock = params.fromBlock;
        const toBlock = params.toBlock ?? await this.provider.getBlockNumber();

        const logs: TxLog[] = [];

        for (let start = fromBlock; start <= toBlock; start += maxQuerySize) {
            const rawEnd = start + maxQuerySize;
            const end = rawEnd < toBlock ? rawEnd : toBlock;
            const result = await this.provider.getLogs({
                address: params.address as `0x${string}`,
                fromBlock: start,
                toBlock: end,
            })

            logs.push(...result);
        }

        return logs;
    }

    async getCode(address: string): Promise<string> {
        return this.provider.getCode(address);
    }

    async getBlockNumber() {
        return this.provider.getBlockNumber();
    }

    async makeContractRequest<
        Contract extends keyof typeof abis,
        Abi extends typeof abis[Contract],
        FunctionName extends ContractFunctionName<Abi>,
        Args extends EncodeFunctionDataParameters<Abi, FunctionName>['args'],
        ArgsArray extends Args extends undefined ? [] : Args extends ReadonlyArray<unknown> ? Args : []
    >(
        contractAddress: Address,
        contractName: Contract,
        functionName: FunctionName,
        ...args: ArgsArray
    ): Promise<DecodeFunctionResultReturnType<Abi, FunctionName>> {
        const abi = abis[contractName];
        const data = encodeFunctionData({
            abi,
            functionName,
            args,
        } as never);

        const result = await this.request({
            method: 'eth_call',
            params: [{
                to: toHex(contractAddress, { size: 20 }),
                data
            }, 'latest'],
        });

        return decodeFunctionResult({
            abi,
            functionName,
            data: result,
        } as never) as never;
    }
}
