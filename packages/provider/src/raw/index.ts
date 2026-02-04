import type { EIP1193Client } from "@corpus-core/colibri-stateless";
import { EthereumProvider, TransactionReceipt, TxLog } from "..";
import { HexString, hexToBigInt, hexToNumber, maybeQuantityToNumber, toQuantityHex } from "./hex";

export const raw = (client: EIP1193Client): EthereumProvider<EIP1193Client> => {
    const getTransactionReceipt = async (txHash: string): Promise<TransactionReceipt | null> => {
        const receipt = await client.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash],
        }) as RpcReceipt;

        if (!receipt) return null;

        return convertReceipt(receipt);
    };

    return {
        _internal: client,
        async getLogs(params: { address: string; fromBlock: number; toBlock: number }): Promise<TxLog[]> {
            const logs = await client.request({
                method: 'eth_getLogs',
                params: [{
                    ...params,
                    fromBlock: toQuantityHex(params.fromBlock),
                    toBlock: toQuantityHex(params.toBlock),
                }],
            }) as RpcLog[];

            return logs.map(convertLog);
        },
        async getBlockNumber(): Promise<number> {
            const value = await client.request({
                method: 'eth_blockNumber',
                params: [],
            });

            return maybeQuantityToNumber(value);
        },
        async waitForTransaction(txHash: string): Promise<void> {
            const start = Date.now();

            const timeoutMs = 10000;
            const pollIntervalMs = 100;

            while (true) {
                const receipt = await getTransactionReceipt(txHash);

                if (receipt) return;

                if (Date.now() - start > timeoutMs) {
                    throw new Error(`Timed out waiting for transaction: ${txHash}`);
                }

                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }
        },
        async getBalance(address: string): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_getBalance',
                params: [address],
            }) as HexString;

            return hexToBigInt(hex);
        },
        async getCode(address: string): Promise<string> {
            const hex = await client.request({
                method: 'eth_getCode',
                params: [address],
            }) as HexString;

            return hex ?? '0x';
        },
        getTransactionReceipt,
    }
}

type RpcLog = {
    blockNumber: HexString;
    topics: string[];
    data: HexString;
    address: HexString;
};

type RpcReceipt = {
    blockNumber: HexString;
    status?: HexString;
    logs: RpcLog[];
    gasUsed: HexString;
};

const convertLog = (log: RpcLog): TxLog => ({
    blockNumber: hexToNumber(log.blockNumber),
    topics: [...log.topics],
    data: log.data,
    address: log.address,
});

const convertReceipt = (receipt: RpcReceipt): TransactionReceipt => ({
    blockNumber: hexToNumber(receipt.blockNumber),
    status: receipt.status ? hexToNumber(receipt.status) : 0,
    logs: receipt.logs.map(convertLog),
    gasUsed: hexToBigInt(receipt.gasUsed),
});
