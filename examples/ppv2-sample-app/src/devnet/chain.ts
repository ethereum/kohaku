/**
 * DEVNET SIDE — an in-memory stand-in for Sepolia.
 *
 * Holds raw event logs, a block head, receipts, and the keystore-registration
 * flag, and answers the JSON-RPC subset the plugin's RPC adapter uses
 * (`eth_getLogs`, `eth_call`, `eth_getTransactionReceipt`, block number).
 * Everything here is demo plumbing — a real wallet points the Host `provider`
 * at an actual RPC endpoint or light client instead.
 */
import type { EthereumProvider } from "@kohaku-eth/provider";
import { keccak256, numberToHex, pad, toHex } from "viem";
import type { Hex } from "viem";

/** A raw `eth_getLogs` entry, as the RPC adapter expects to decode it. */
export type RawLog = {
    address: Hex;
    topics: [Hex, ...Hex[]];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

const ZERO_WORD: Hex = `0x${"00".repeat(32)}`;
const ONE_WORD: Hex = pad("0x01");

export class DevnetChain {
    private logs: RawLog[] = [];
    private head: bigint;
    private receipts = new Map<string, { blockNumber: bigint }>();
    private logIndexCounter = 0;
    private txCounter = 0;
    /**
     * The keystore contract address (registration reads route to the
     * registration flag). Sourced from the SDK's `DEPLOYMENTS` fallback, since
     * the plugin uses it when an entrypoint factory overrides `deployment`.
     */
    private readonly keystoreAddress: string;
    /** Nonzero keystore word once the owner's registration has mined. */
    keystoreRegistered = false;

    constructor(options: { keystoreAddress: string; startBlock?: bigint }) {
        this.keystoreAddress = options.keystoreAddress.toLowerCase();
        this.head = options.startBlock ?? 100n;
    }

    get blockNumber(): bigint {
        return this.head;
    }

    /** Mine an empty block with one transaction in it; returns the tx hash. */
    mineTransaction(): { txHash: Hex; blockNumber: bigint } {
        this.head += 1n;
        const txHash = keccak256(toHex(`devnet-tx-${this.txCounter++}`));

        this.receipts.set(txHash.toLowerCase(), { blockNumber: this.head });

        return { txHash, blockNumber: this.head };
    }

    /** Append an event log emitted by the given mined transaction. */
    appendLog(
        log: Omit<RawLog, "blockNumber" | "transactionHash" | "logIndex">,
        minedAt: { txHash: Hex; blockNumber: bigint },
    ): void {
        this.logs.push({
            ...log,
            blockNumber: numberToHex(minedAt.blockNumber),
            transactionHash: minedAt.txHash,
            logIndex: numberToHex(this.logIndexCounter++),
        });
    }

    /** The Host `EthereumProvider` view of this chain. */
    provider(): EthereumProvider {
        const getLogs = (params: unknown[]): RawLog[] => {
            const filter = (params[0] ?? {}) as { fromBlock?: Hex; toBlock?: Hex };
            const from = filter.fromBlock ? BigInt(filter.fromBlock) : 0n;
            const to =
                filter.toBlock && filter.toBlock !== ("latest" as string)
                    ? BigInt(filter.toBlock)
                    : this.head;

            return this.logs.filter((log) => {
                const block = BigInt(log.blockNumber);

                return block >= from && block <= to;
            });
        };

        const call = (params: unknown[]): Hex => {
            const request = (params[0] ?? {}) as { to?: string; data?: string };

            if (process.env["DEVNET_TRACE"]) {
                console.error(`[devnet] eth_call to=${request.to} data=${request.data?.slice(0, 10)}`);
            }

            // Keystore reads answer the registration state; every other read
            // (e.g. the pool's commitment-timestamp check during discovery)
            // returns a nonzero word, mirroring the plugin's integration rigs.
            if (request.to?.toLowerCase() === this.keystoreAddress) {
                return this.keystoreRegistered ? ONE_WORD : ZERO_WORD;
            }

            return ONE_WORD;
        };

        const receipt = (txHash: string) => {
            const mined = this.receipts.get(txHash.toLowerCase());

            if (!mined) return null;

            return {
                transactionHash: txHash,
                status: "0x1",
                blockNumber: numberToHex(mined.blockNumber),
                logs: [],
            };
        };

        return {
            _internal: undefined,
            // Arrow property (not method shorthand) so `this` stays the chain.
            request: async (req: { method: string; params?: unknown[] }) => {
                const params = req.params ?? [];

                switch (req.method) {
                    case "eth_getLogs":
                        return getLogs(params);
                    case "eth_call":
                        return call(params);
                    case "eth_getTransactionReceipt":
                        return receipt(params[0] as string);
                    case "eth_blockNumber":
                        return numberToHex(this.head);
                    case "eth_chainId":
                        return numberToHex(11155111n);
                    default:
                        return ZERO_WORD;
                }
            },
            getChainId: async () => 11155111n,
            getBlockNumber: async () => this.head,
            waitForTransaction: async () => undefined,
            getTransactionReceipt: async (txHash: string) => {
                const mined = this.receipts.get(txHash.toLowerCase());

                if (!mined) return null;

                return { blockNumber: mined.blockNumber, status: 1n, logs: [], gasUsed: 0n };
            },
            getLogs: async () => [],
            call: async () => ZERO_WORD,
            getBalance: async () => 0n,
            getCode: async () => "0x",
            estimateGas: async () => 0n,
            getGasPrice: async () => 0n,
            getTransactionCount: async () => 0,
        } as unknown as EthereumProvider;
    }
}
