import { EthereumProvider, TransactionReceipt, TxLog } from "..";
import { HexString, hexToBigInt, hexToNumber } from "./hex";

// Signature of `on` and `removeListener` are more loose than the actual EIP-1193 spec so that Helios can still satisfy them
// When https://github.com/a16z/helios/issues/775 is fixed, return types can be switched to `this`
export interface Eip1193Like {
    request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
    on(event: string, callback: (data: unknown) => void): unknown;
    removeListener(event: string, callback: (data: unknown) => void): unknown;
}

export const raw = (client: Eip1193Like): EthereumProvider<Eip1193Like> => {
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
                params: [params],
            }) as RpcLog[];

            return logs.map(convertLog);
        },
        async getBlockNumber(): Promise<number> {
            const hex = await client.request({
                method: 'eth_blockNumber',
                params: [],
            });

            if (typeof hex !== 'string') {
                throw new Error('Expected hex string, got: ' + typeof hex);
            }

            return hexToNumber(hex);
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
