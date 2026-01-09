import type { RailgunLog, RailgunProvider, TransactionReceipt } from './provider';

export type HexString = `0x${string}`;

export type Eip1193RequestArgs = {
    method: string;
    params?: unknown[] | Record<string, unknown>;
};

/**
 * Minimal EIP-1193 provider interface.
 * Colibri-Stateless and browser wallets (e.g. MetaMask) implement this.
 */
export type Eip1193Provider = {
    request: (args: Eip1193RequestArgs) => Promise<unknown>;
};

export type Eip1193AdapterOptions = {
    /**
     * Poll interval for `waitForTransaction`.
     * Default: 1000ms
     */
    pollIntervalMs?: number;
    /**
     * Timeout for `waitForTransaction`.
     * Default: 120000ms
     */
    timeoutMs?: number;
};

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

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function assertHexQuantity(value: string): asserts value is HexString {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error(`Expected hex quantity, got: ${String(value)}`);
    }
}

function toQuantityHex(value: number | bigint): HexString {
    const v = typeof value === 'bigint' ? value : BigInt(value);

    if (v < 0n) {
        throw new Error(`Expected non-negative quantity, got: ${String(value)}`);
    }

    return `0x${v.toString(16)}`;
}

function hexToBigInt(value: string): bigint {
    assertHexQuantity(value);

    return BigInt(value);
}

function hexToNumber(value: string): number {
    const n = hexToBigInt(value);

    return Number(n);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function convertLog(log: RpcLog): RailgunLog {
    return {
        blockNumber: hexToNumber(log.blockNumber),
        topics: [...log.topics],
        data: log.data,
        address: log.address,
    };
}

function convertReceipt(receipt: RpcReceipt): TransactionReceipt {
    return {
        blockNumber: hexToNumber(receipt.blockNumber),
        status: receipt.status ? hexToNumber(receipt.status) : 0,
        logs: receipt.logs.map(convertLog),
        gasUsed: hexToBigInt(receipt.gasUsed),
    };
}

/**
 * Adapter that implements `RailgunProvider` over an EIP-1193 provider.
 * This allows using Colibri-Stateless (or a browser wallet provider) as the RPC source.
 */
export class Eip1193ProviderAdapter implements RailgunProvider {
    private readonly pollIntervalMs: number;
    private readonly timeoutMs: number;

    constructor(
        private readonly provider: Eip1193Provider,
        options: Eip1193AdapterOptions = {},
    ) {
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    private async request<T>(method: string, params?: unknown[] | Record<string, unknown>): Promise<T> {
        const result = await this.provider.request({ method, ...(params ? { params } : {}) });

        return result as T;
    }

    async getLogs(params: { address: string; fromBlock: number; toBlock: number }): Promise<RailgunLog[]> {
        const filter: Record<string, unknown> = {
            fromBlock: toQuantityHex(params.fromBlock),
            toBlock: toQuantityHex(params.toBlock),
        };

        // Some callers pass empty string to mean "no address filter".
        // `eth_getLogs` expects `address` omitted to match all.
        if (params.address) {
            filter['address'] = params.address;
        }

        const logs = await this.request<RpcLog[]>('eth_getLogs', [filter]);

        return logs.map(convertLog);
    }

    async getBlockNumber(): Promise<number> {
        const hex = await this.request<HexString>('eth_blockNumber');

        return hexToNumber(hex);
    }

    async waitForTransaction(txHash: string): Promise<void> {
        const start = Date.now();

         
        while (true) {
            const receipt = await this.getTransactionReceipt(txHash);

            if (receipt) return;

            if (Date.now() - start > this.timeoutMs) {
                throw new Error(`Timed out waiting for transaction: ${txHash}`);
            }

            await sleep(this.pollIntervalMs);
        }
    }

    async getBalance(address: string): Promise<bigint> {
        const hex = await this.request<HexString>('eth_getBalance', [address, 'latest']);

        return hexToBigInt(hex);
    }

    async getCode(address: string): Promise<string> {
        const code = await this.request<HexString>('eth_getCode', [address, 'latest']);

        return code ?? '0x';
    }

    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
        const receipt = await this.request<RpcReceipt | null>('eth_getTransactionReceipt', [txHash]);

        if (!receipt) return null;

        return convertReceipt(receipt);
    }
}


