import { EthereumProvider } from '@kohaku-eth/provider';
import { EthRpcAdapter, RawLog } from 'node_modules/tc-js/dist/pkg/tc_rs';

export class EthereumProviderAdapter implements EthRpcAdapter {
    constructor(private provider: EthereumProvider) { }

    async getChainId(): Promise<bigint> {
        return await this.provider.getChainId();
    }

    async getBlockNumber(): Promise<bigint> {
        return await this.provider.getBlockNumber();
    }

    async getLogs(address: `0x${string}`, eventSignature: `0x${string}` | undefined, fromBlock: number | undefined, toBlock: number | undefined): Promise<RawLog[]> {
        const logs = await this.provider.getLogs({
            address,
            fromBlock: fromBlock ? BigInt(fromBlock) : undefined,
            toBlock: toBlock ? BigInt(toBlock) : undefined,
            topics: eventSignature ? [eventSignature] : undefined,
        });

        const rawLogs: RawLog[] = logs.map(log => ({
            blockNumber: Number(log.blockNumber),
            blockTimestamp: null, // Provider doesn't return timestamp in logs
            transactionHash: null, // Provider doesn't return transaction hash in logs
            address,
            topics: log.topics as `0x${string}`[], // TODO: Confirm this is valid
            data: log.data as `0x${string}`,  // TODO: Confirm this is valid
        }));
        return rawLogs;
    }

    async ethCall(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
        return await this.provider.call(to, data);
    }

    async estimateGas(to: `0x${string}`, from: `0x${string}` | undefined, data: `0x${string}`): Promise<bigint> {
        return await this.provider.estimateGas(to, from, data);
    }

    async getGasPrice(): Promise<bigint> {
        return await this.provider.getGasPrice();
    }
}