import type { Host, Storage as PluginStorage } from "@kohaku-eth/plugins";
import type { EthereumProvider } from "@kohaku-eth/provider";
import { vi } from "vitest";
import { createMockKeystore, TEST_MNEMONIC } from "../../utils/mock-host";

export { TEST_MNEMONIC };

/** In-memory, async, get/set-only storage mirroring the Host `Storage` contract. */
export function createMemoryStorage(): PluginStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();

    return {
        _brand: "Storage",
        map,
        async set(key, value) {
            map.set(key, value);
        },
        async get(key) {
            return map.get(key) ?? null;
        },
    };
}

/** JSON-RPC responses the mock provider returns, keyed by method. */
export type RpcHandlers = Partial<Record<string, (params: unknown[]) => unknown>>;

/**
 * A controllable {@link EthereumProvider} that answers offline. Reads default to
 * "empty" (`eth_call` → 32 zero-bytes, `eth_getLogs` → `[]`, no receipt), so a
 * plugin can construct and sync against an account with no history. Override any
 * method via {@link RpcHandlers}.
 */
export function createMockProvider(
    handlers: RpcHandlers = {},
    options: { blockNumber?: bigint } = {},
): { provider: EthereumProvider; setBlockNumber: (n: bigint) => void } {
    let currentBlock = options.blockNumber ?? 0n;
    const ZERO32 = `0x${"00".repeat(32)}` as const;
    const request = vi.fn(async (req: { method: string; params?: unknown[] }) => {
        const handler = handlers[req.method];

        if (handler) return handler((req.params ?? []) as unknown[]);

        switch (req.method) {
            case "eth_getLogs":
                return [];
            case "eth_getTransactionReceipt":
                return null;
            case "eth_call":
                return ZERO32;
            case "eth_blockNumber":
                // Track setBlockNumber() so JSON-RPC and getBlockNumber() agree
                // on the chain head regardless of which API the adapter uses.
                return `0x${currentBlock.toString(16)}`;
            default:
                return ZERO32;
        }
    });

    const provider = {
        _internal: undefined,
        request,
        getChainId: vi.fn(async () => 11155111n),
        getBlockNumber: vi.fn(async () => currentBlock),
        waitForTransaction: vi.fn(async () => undefined),
        getTransactionReceipt: vi.fn(async () => null),
        getLogs: vi.fn(async () => []),
        call: vi.fn(async () => ZERO32),
        getBalance: vi.fn(async () => 0n),
        getCode: vi.fn(async () => "0x"),
        estimateGas: vi.fn(async () => 0n),
        getGasPrice: vi.fn(async () => 0n),
        getTransactionCount: vi.fn(async () => 0),
    } as unknown as EthereumProvider;

    return {
        provider,
        setBlockNumber: (n: bigint) => {
            currentBlock = n;
        },
    };
}

/** Optional overrides when building a mock host. */
export type MockHostOptions = {
    mnemonic?: string;
    rpc?: RpcHandlers;
    /** Latest block the mock chain reports (discovery scans up to it). */
    blockNumber?: bigint;
    fetch?: Host["network"]["fetch"];
};

/**
 * A fully offline {@link Host}: real BIP-32 keystore (deterministic keys), an
 * in-memory storage, a controllable mock provider, and a rejecting `fetch` by
 * default (override for ASP/relayer/artifact flows). Enough to construct a plugin
 * and exercise no-history reads without touching the network.
 */
export function createMockHost(options: MockHostOptions = {}): {
    host: Host;
    provider: EthereumProvider;
    storage: ReturnType<typeof createMemoryStorage>;
    /** Advance the mock chain head (discovery re-scans only past the cursor). */
    setBlockNumber: (n: bigint) => void;
} {
    const { provider, setBlockNumber } = createMockProvider(options.rpc, {
        blockNumber: options.blockNumber,
    });
    const storage = createMemoryStorage();
    const fetchImpl =
        options.fetch ??
        (vi.fn(async () => {
            throw new Error("mock host: network.fetch not stubbed for this test");
        }) as unknown as Host["network"]["fetch"]);

    const host: Host = {
        keystore: createMockKeystore(options.mnemonic),
        network: { fetch: fetchImpl },
        storage,
        provider,
    };

    return { host, provider, storage, setBlockNumber };
}
