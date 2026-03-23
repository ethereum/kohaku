export { ViemSignerAdapter } from './signer';

import type { TxLog, TransactionReceipt, CallData } from '../tx';
import type { EthereumProvider } from '../provider';
import { Filter } from 'ox';
import type { PublicClient } from 'viem';

export const viem = (client: PublicClient): EthereumProvider<PublicClient> => {
    return {
        _internal: client,
        request: client.request.bind(client),
        async getLogs(params: Filter.Filter): Promise<TxLog[]> {
            const logs = await client.getLogs({
                address: params.address as `0x${string}`,
                fromBlock: params.fromBlock as bigint,
                toBlock: params.toBlock as bigint,
                // topics: params.topics as HexString[],
            });

            return logs;
        },
        async getChainId(): Promise<bigint> {
            return BigInt(await client.getChainId());
        },
        async getBlockNumber(): Promise<bigint> {
            return await client.getBlockNumber();
        },
        async waitForTransaction(txHash: string): Promise<void> {
            await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
        },
        async getBalance(address: string): Promise<bigint> {
            return client.getBalance({ address: address as `0x${string}` });
        },
        async getCode(address: string): Promise<string> {
            const code = await client.getCode({ address: address as `0x${string}` });

            return code ?? '0x';
        },
        async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
            const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

            if (!receipt) return null;

            return {
                blockNumber: BigInt(receipt.blockNumber),
                status: receipt.status === 'success' ? 1n : 0n,
                logs: receipt.logs,
                gasUsed: BigInt(receipt.gasUsed),
            };
        },
        async call(call: CallData): Promise<`0x${string}` | undefined> {
            const result = await client.call({
                to: call.to,
                account: call.from,
                data: call.input,
                value: call.value ? BigInt(call.value) : undefined,
                gas: call.gas ? BigInt(call.gas) : undefined,
                gasPrice: call.gasPrice ? BigInt(call.gasPrice) : undefined,
            });

            return result.data;
        },
        async estimateGas(call: CallData): Promise<bigint> {
            const gas = await client.estimateGas({
                to: call.to,
                account: call.from,
                data: call.input,
                value: call.value ? BigInt(call.value) : undefined,
            });

            return gas;
        },
        async getGasPrice(): Promise<bigint> {
            return await client.getGasPrice();
        }
    };
};
