import { PublicClient } from 'viem';
import { EthRpcAdapter, RawLog } from './pkg/eth_rpc.js';

export class ViemEthRpcAdapter implements EthRpcAdapter {
    constructor(private client: PublicClient) { }

    async getChainId(): Promise<bigint> {
        return BigInt(await this.client.getChainId());
    }

    async getBlockNumber(): Promise<bigint> {
        const number = await this.client.getBlockNumber();
        return BigInt(number);
    }

    async getLogs(address: `0x${string}`, eventSignature: `0x${string}` | undefined, fromBlock: number | undefined, toBlock: number | undefined): Promise<RawLog[]> {
        const params: any = {
            address,
        };

        if (fromBlock !== undefined) {
            params.fromBlock = `0x${fromBlock.toString(16)}`;
        }

        if (toBlock !== undefined) {
            params.toBlock = `0x${toBlock.toString(16)}`;
        }

        if (eventSignature) {
            params.topics = [eventSignature];
        }

        const logs = await this.client.request({
            method: "eth_getLogs",
            params: [params],
        });

        const rawLogs: RawLog[] = logs.map((log) => ({
            block_number: log.blockNumber ? Number(BigInt(log.blockNumber)) : null,
            block_timestamp: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : null,
            transaction_hash: log.transactionHash,
            address: log.address,
            topics: log.topics as `0x${string}`[],
            data: log.data
        }));

        return rawLogs;
    }

    async ethCall(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
        const result = await this.client.call({
            to,
            data,
        });
        return result.data ? result.data : '0x';
    }

    async estimateGas(to: `0x${string}`, from: `0x${string}` | undefined, data: `0x${string}`): Promise<bigint> {
        const result = await this.client.estimateGas({
            account: from,
            to,
            data,
        });
        return result;
    }

    async getGasPrice(): Promise<bigint> {
        const result = await this.client.getGasPrice();
        return result;
    }
}