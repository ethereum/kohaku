import { Hex } from "ox/Hex";
import { EthereumProvider, TransactionReceipt, TxLog } from "..";
import { HexString, hexToBigInt } from "./hex";
import { Provider } from 'ox/Provider';
import { Block, Filter } from "ox";

export const raw = (client: Provider): EthereumProvider<Provider> => {
    const getTransactionReceipt = async (txHash: string): Promise<TransactionReceipt | null> => {
        const receipt = await client.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash as Hex],
        }) as RpcReceipt;

        if (!receipt) return null;

        return convertReceipt(receipt);
    };

    return {
        _internal: client,
        request: client.request,
        async getLogs(params: Filter.Filter): Promise<TxLog[]> {
            const logs = await client.request({
                method: 'eth_getLogs',
                params: [Filter.toRpc(params)],
            });

            return logs.map(convertLog);
        },
        async getChainId(): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_chainId',
                params: undefined,
            });

            return hexToBigInt(hex);
        },
        async getBlockNumber(): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_blockNumber',
                params: undefined,
            });

            return hexToBigInt(hex);
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
        async getBalance(address: Hex, block?: Block.Identifier | Block.Tag): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_getBalance',
                params: [address, block ?? 'latest'],
            }) as HexString;

            return hexToBigInt(hex);
        },
        async getCode(address: Hex, block?: Block.Identifier | Block.Tag): Promise<string> {
            const hex = await client.request({
                method: 'eth_getCode',
                params: [address, block ?? 'latest'],
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
    blockNumber: hexToBigInt(log.blockNumber),
    topics: [...log.topics],
    data: log.data,
    address: log.address,
});

const convertReceipt = (receipt: RpcReceipt): TransactionReceipt => ({
    blockNumber: hexToBigInt(receipt.blockNumber),
    status: receipt.status ? hexToBigInt(receipt.status) : BigInt(0),
    logs: receipt.logs.map(convertLog),
    gasUsed: hexToBigInt(receipt.gasUsed),
});
