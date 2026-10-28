import { Hex } from "ox/Hex";
import { EthereumProvider, TransactionReceipt, TxLog, CallData } from "..";
import { HexString, hexToBigInt } from "./hex";
import { Provider } from 'ox/Provider';
import { Block, Filter } from "ox";
import { toHex } from "viem";
import { resolveWaitForTransactionOptions, waitForReceipt, WaitForTransactionOptions } from './wait';

export type { WaitForTransactionOptions } from './wait';

export type RawProviderOptions = {
    waitForTransaction?: Partial<WaitForTransactionOptions>;
};

export const raw = (client: Provider, options: RawProviderOptions = {}): EthereumProvider<Provider> => {
    const waitOptions = resolveWaitForTransactionOptions(options.waitForTransaction);
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
        request: client.request.bind(client),
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
        waitForTransaction: (txHash: string): Promise<void> =>
            waitForReceipt(txHash, () => getTransactionReceipt(txHash), waitOptions),
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
        async call(call: CallData): Promise<`0x${string}` | undefined> {
            const result = await client.request({
                method: 'eth_call',
                params: [call, call.block ?? 'latest'],
            }) as `0x${string}`;

            return result;
        },
        async estimateGas(call: CallData): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_estimateGas',
                params: [call],
            }) as HexString;

            return hexToBigInt(hex);
        },
        async getGasPrice(): Promise<bigint> {
            const hex = await client.request({
                method: 'eth_gasPrice',
                params: undefined,
            }) as HexString;

            return hexToBigInt(hex);
        },
        getTransactionReceipt,
        async getTransactionCount(address: `0x${string}`, block?: number): Promise<number> {
            const hex = await client.request({
                method: 'eth_getTransactionCount',
                params: [address, block ? toHex(block) : 'latest'],
            }) as HexString;

            return Number(hexToBigInt(hex));
        }
    }
}

type RpcLog = {
    blockNumber: HexString;
    topics: string[];
    data: HexString;
    address: HexString;
    logIndex?: HexString | null;
    transactionHash?: HexString | null;
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
    ...(log.logIndex ? { logIndex: Number(hexToBigInt(log.logIndex)) } : {}),
    ...(log.transactionHash ? { transactionHash: log.transactionHash } : {}),
});

const convertReceipt = (receipt: RpcReceipt): TransactionReceipt => ({
    blockNumber: hexToBigInt(receipt.blockNumber),
    status: receipt.status ? hexToBigInt(receipt.status) : BigInt(0),
    logs: receipt.logs.map(convertLog),
    gasUsed: hexToBigInt(receipt.gasUsed),
});
