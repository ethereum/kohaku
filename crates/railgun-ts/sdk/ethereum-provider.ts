import type { EthereumProvider } from '@kohaku-eth/provider';
import type { Eip1193Provider, RawLog } from './lib';

type EthRpcLog = {
    address?: string;
    topics?: string[];
    data?: string;
    blockNumber?: string;
    transactionHash?: string;
};

function toBlockHex(n: number): `0x${string}` {
    return `0x${n.toString(16)}`;
}

/**
 * Adapter that wraps an EthereumProvider and exposes the Eip1193Provider interface
 * for the Rust WASM transport to bind against.
 *
 * TODO: Unify this with the Eip1193Provider directly and remove the need for this adapter.
 */
export class EthereumProviderAdapter implements Eip1193Provider {
    constructor(private provider: EthereumProvider) { }

    async getChainId(): Promise<bigint> {
        return await this.provider.getChainId();
    }

    async getBlockNumber(): Promise<bigint> {
        return await this.provider.getBlockNumber();
    }

    async getLogs(address: `0x${string}`, eventSignature: `0x${string}` | undefined, fromBlock: number | undefined, toBlock: number | undefined): Promise<RawLog[]> {
        const filter: {
            address: `0x${string}`;
            fromBlock?: `0x${string}`;
            toBlock?: `0x${string}`;
            topics?: [`0x${string}`];
        } = { address };
        if (fromBlock !== undefined) filter.fromBlock = toBlockHex(fromBlock);
        if (toBlock !== undefined) filter.toBlock = toBlockHex(toBlock);
        if (eventSignature) filter.topics = [eventSignature];

        const logs = await this.provider.request({
            method: 'eth_getLogs',
            params: [filter],
        }) as EthRpcLog[];

        return logs.map((log) => {
            const transactionHash = log.transactionHash;
            if (!transactionHash?.startsWith('0x')) {
                throw new Error(
                    '@kohaku-eth/railgun: eth_getLogs entry missing transactionHash (required for WASM sync)'
                );
            }
            return {
                blockNumber: log.blockNumber != null ? Number(BigInt(log.blockNumber)) : null,
                blockTimestamp: null,
                transactionHash: transactionHash as `0x${string}`,
                address: (log.address ?? address) as `0x${string}`,
                topics: (log.topics ?? []) as `0x${string}`[],
                data: (log.data ?? '0x') as `0x${string}`,
            };
        });
    }

    async ethCall(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
        return await this.provider.call({ to, input: data }) ?? '0x';
    }

    async estimateGas(to: `0x${string}`, from: `0x${string}` | undefined, data: `0x${string}`): Promise<bigint> {
        return await this.provider.estimateGas({ to, from, input: data });
    }

    async getGasPrice(): Promise<bigint> {
        return await this.provider.getGasPrice();
    }
}
