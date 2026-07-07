import type { EthereumProvider } from "@kohaku-eth/provider";
import type {
    DecodedEventLog,
    GetLogsParams,
    Hex,
    IRPCInteractor,
    ReadContractParams,
    TxReceipt,
} from "@privacy-pools-v2/sdk";
import {
    type Abi,
    type AbiEvent,
    decodeEventLog,
    decodeFunctionResult,
    encodeFunctionData,
    numberToHex,
    toEventSelector,
} from "viem";

/** Raw `eth_getLogs` / receipt-log entry (full fields, unlike the lossy provider abstraction). */
type RawLog = {
    address: Hex;
    topics: [Hex, ...Hex[]];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

type RawReceipt = {
    status: Hex;
    blockNumber: Hex;
    logs: RawLog[];
};

/**
 * Adapts the Kohaku {@link EthereumProvider} onto the SDK's read-only
 * {@link IRPCInteractor}. Uses raw `provider.request(...)` JSON-RPC plus viem's
 * pure ABI codec — not the provider's convenience `getLogs`/`getTransactionReceipt`,
 * which drop `transactionHash`/`logIndex` that the SDK's `DecodedEventLog` /
 * `TxReceipt` require. No write/wallet path (INV-1).
 */
export class KohakuRpcInteractor implements IRPCInteractor {
    constructor(private readonly provider: EthereumProvider) {}

    async readContract(params: ReadContractParams): Promise<unknown> {
        const abi = params.abi as unknown as Abi;
        const data = encodeFunctionData({
            abi,
            functionName: params.functionName,
            args: params.args as readonly unknown[] | undefined,
        });
        const raw = (await this.provider.request({
            method: "eth_call",
            params: [{ to: params.address, data }, "latest"],
        })) as Hex;

        return decodeFunctionResult({
            abi,
            functionName: params.functionName,
            data: raw && raw !== "0x" ? raw : "0x",
        });
    }

    async getBlockNumber(): Promise<Hex> {
        return numberToHex(await this.provider.getBlockNumber());
    }

    async waitForTransactionReceipt(hash: Hex): Promise<TxReceipt> {
        await this.provider.waitForTransaction(hash);
        const receipt = (await this.provider.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
        })) as RawReceipt | null;

        if (!receipt) {
            throw new Error(`No receipt for transaction ${hash}`);
        }

        return {
            status: receipt.status === "0x1",
            blockNumber: receipt.blockNumber,
            txHash: hash,
            logs: receipt.logs.map((log) => ({
                address: log.address,
                topics: log.topics,
                data: log.data,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: Number(BigInt(log.logIndex)),
            })),
        };
    }

    async getLogs(params: GetLogsParams): Promise<DecodedEventLog[]> {
        const events = params.events as unknown as AbiEvent[];
        const topic0s = events.map((event) => toEventSelector(event));
        const raw = (await this.provider.request({
            method: "eth_getLogs",
            params: [
                {
                    address: params.address,
                    topics: [topic0s],
                    fromBlock: numberToHex(params.fromBlock ?? 0n),
                    toBlock: params.toBlock !== undefined ? numberToHex(params.toBlock) : "latest",
                },
            ],
        })) as RawLog[];

        return raw.flatMap((log) => this.decodeLog(log, events));
    }

    async getLogsPaginated(params: GetLogsParams): Promise<DecodedEventLog[]> {
        const from = params.fromBlock ?? 0n;
        const to = params.toBlock ?? (await this.provider.getBlockNumber());
        const out: DecodedEventLog[] = [];

        await this.scanWindow(params, from, to, 5000n, out);

        return out;
    }

    /** Scan `[from,to]` in windows; bisect a window that fails (provider size/rate caps). */
    private async scanWindow(
        params: GetLogsParams,
        from: bigint,
        to: bigint,
        window: bigint,
        out: DecodedEventLog[],
    ): Promise<void> {
        for (let start = from; start <= to; start += window) {
            const rawEnd = start + window - 1n;
            const end = rawEnd < to ? rawEnd : to;

            try {
                out.push(...(await this.getLogs({ ...params, fromBlock: start, toBlock: end })));
            } catch (err) {
                if (end > start) {
                    const mid = start + (end - start) / 2n;

                    await this.scanWindow(params, start, mid, mid - start + 1n, out);
                    await this.scanWindow(params, mid + 1n, end, end - mid, out);
                } else {
                    throw err;
                }
            }
        }
    }

    /** Decode a single raw log against the event ABI set; skip non-matching logs. */
    private decodeLog(log: RawLog, events: AbiEvent[]): DecodedEventLog[] {
        try {
            const decoded = decodeEventLog({ abi: events, data: log.data, topics: log.topics });

            return [
                {
                    eventName: decoded.eventName as string,
                    args: (decoded.args ?? {}) as Record<string, unknown>,
                    blockNumber: log.blockNumber,
                    transactionHash: log.transactionHash,
                },
            ];
        } catch {
            return [];
        }
    }
}
