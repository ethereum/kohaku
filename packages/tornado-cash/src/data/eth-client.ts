/* eslint-disable max-lines */
import type { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import { ContractFunctionName, decodeFunctionResult, DecodeFunctionResultReturnType, encodeFunctionData, EncodeFunctionDataParameters, erc20Abi, toHex } from 'viem';
import { Address } from "../interfaces/types.interface";
import { aggregatorAbi } from "./abis/aggregator.abi";
import { instanceRegistryAbi } from "./abis/instance-registry.abi";
import { paymasterAbi } from "./abis/paymaster.abi";
import { poolAbi } from "./abis/pool.abi";

function logPageTooLarge(logs: TxLog[]): boolean {
    if (logs.length > 10_000) return true;

    let chars = 0;

    for (const log of logs) {
        if (log.topics.length > 4) return true;

        chars += log.data.length + log.address.length + (log.transactionHash?.length ?? 0);

        for (const topic of log.topics) chars += topic.length;

        if (chars > 4 * 1024 * 1024) return true;
    }

    return false;
}

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
    paymaster: paymasterAbi,
} as const;

interface IGetLogsResult {
    logs: TxLog[];
    fromBlock: bigint;
    toBlock: bigint;
}

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
    }: GetLogsParams): Promise<IGetLogsResult> {
        if (maxQuerySize <= 0n) throw new Error('maxQuerySize must be positive');

        const fromBlock = params.fromBlock;
        const toBlock = params.toBlock ?? await this.provider.getBlockNumber();

        // An empty range scanned nothing: report the cursor as just below
        // `fromBlock` so callers never advance past blocks they did not read.
        if (fromBlock > toBlock) {
            return { logs: [], fromBlock, toBlock: fromBlock - 1n };
        }

        const logs: TxLog[] = [];
        let pageSize = maxQuerySize;

        // Ranges are inclusive; advance only after accepting a page so no block is missed or repeated.
        for (let start = fromBlock; start <= toBlock;) {
            const rawEnd = start + pageSize - 1n;
            const end = rawEnd < toBlock ? rawEnd : toBlock;
            const result = await this.provider.getLogs({
                address: params.address as `0x${string}`,
                fromBlock: start,
                toBlock: end,
            });

            // Retry dense pages over fewer blocks; never truncate event history.
            if (logPageTooLarge(result)) {
                if (start === end) throw new Error(`RPC log page exceeds limits for ${params.address} at block ${start}`);

                pageSize = (end - start + 1n) / 2n;
                continue;
            }

            logs.push(...result);
            start = end + 1n;
            pageSize = pageSize * 2n < maxQuerySize ? pageSize * 2n : maxQuerySize;
        }

        return {
            logs,
            fromBlock,
            toBlock
        };
    }

    async getCode(address: string): Promise<string> {
        return this.provider.getCode(address);
    }

    async getBlockNumber() {
        return this.provider.getBlockNumber();
    }

    /**
     * Whether `address` holds code at `block`. Throws on a response that is not
     * hex-encoded bytecode, so malformed RPC output is never read as "deployed".
     */
    async hasCodeAt(address: Address, block: bigint): Promise<boolean> {
        const code = await this.request({
            method: 'eth_getCode',
            params: [toHex(address, { size: 20 }), toHex(block)],
        });

        if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) {
            throw new Error(`Malformed eth_getCode response for ${toHex(address, { size: 20 })} at block ${block}`);
        }

        return code !== '0x';
    }

    async getDeploymentBlock(address: Address, fromBlock: bigint = 0n): Promise<bigint> {
        let low = fromBlock;
        let high = await this.getBlockNumber();

        if (low > high) {
            throw new Error(`Deployment search start ${low} is past the chain head ${high}`);
        }

        while (low < high) {
            const mid = (low + high) / 2n;

            if (await this.hasCodeAt(address, mid)) {
                high = mid;
            } else {
                low = mid + 1n;
            }
        }

        // The search converges on the head when no probe found code; confirm the
        // result really is deployed rather than persisting the head as a boundary.
        if (!(await this.hasCodeAt(address, low))) {
            throw new Error(`No code for ${toHex(address, { size: 20 })} at or before block ${low}`);
        }

        return low;
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
        return this.makeContractRequestAt('latest', contractAddress, contractName, functionName, ...args);
    }

    /** Like makeContractRequest, but reads the contract's state at `block`. */
    async makeContractRequestAt<
        Contract extends keyof typeof abis,
        Abi extends typeof abis[Contract],
        FunctionName extends ContractFunctionName<Abi>,
        Args extends EncodeFunctionDataParameters<Abi, FunctionName>['args'],
        ArgsArray extends Args extends undefined ? [] : Args extends ReadonlyArray<unknown> ? Args : []
    >(
        block: bigint | 'latest',
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
            }, block === 'latest' ? block : toHex(block)],
        });

        return decodeFunctionResult({
            abi,
            functionName,
            data: result,
        } as never) as never;
    }
}
