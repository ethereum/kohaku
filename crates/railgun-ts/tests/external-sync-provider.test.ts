import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MemoryStorage, MnemonicKeystore, type ExternalSyncProvider, type Host } from "@kohaku-eth/plugins";
import { createRailgunPlugin } from "../sdk/plugin.js";
import { viem } from "@kohaku-eth/provider/viem";
import { startAnvil } from "./utils.js";

const INTEGRATION = process.env.INTEGRATION === "1";
const SEPOLIA_RPC_URL: string | undefined = process.env.RPC_URL_SEPOLIA;

if (!SEPOLIA_RPC_URL)
    throw new Error("RPC_URL_SEPOLIA env must be defined");

let rpcUrl: string;
let anvilServer: Awaited<ReturnType<typeof startAnvil>>["server"];

beforeAll(async () => {
    const anvil = await startAnvil(SEPOLIA_RPC_URL, 11155111);

    anvilServer = anvil.server;
    rpcUrl = anvil.rpcUrl;
}, 60_000);

afterAll(async () => {
    await anvilServer?.stop();
});

function buildHost(externalSyncProvider?: ExternalSyncProvider): Host {
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const eip1193 = viem(publicClient);

    return {
        network: {
            fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, init),
        },
        storage: new MemoryStorage(),
        keystore: MnemonicKeystore.random(),
        provider: eip1193,
        externalSyncProvider,
    };
}

/**
 * Sync must still complete via the existing Subsquid/RPC chain when the host's
 * `externalSyncProvider` has no coverage for the pool (`lastCoveredBlock`
 * throws). Regression test for the `ChainedSyncer::sync` fix that stopped a
 * failing syncer's `latest_block()` from aborting the whole chain.
 */
test("plugin-sync falls back when external provider has no coverage", async () => {
    if (!INTEGRATION) {
        console.warn("Skipping integration test. Set INTEGRATION=1 to run.");
        
        return;
    }

    let lastCoveredBlockCalls = 0;
    const noCoverageProvider: ExternalSyncProvider = {
        streamEvents: async function* () {
            // No events: lastCoveredBlock always throws first, so this is never reached.
        },
        firstCoveredBlock: async () => {
            throw new Error("no coverage");
        },
        lastCoveredBlock: async () => {
            lastCoveredBlockCalls++;
            throw new Error("no coverage");
        },
    };

    const plugin = await createRailgunPlugin(buildHost(noCoverageProvider), { rpcBatchSize: 10_000 });
    const bal = await plugin.balance(undefined);

    expect(lastCoveredBlockCalls).toBeGreaterThan(0);
    expect(bal).toBeDefined();
}, 300 * 1000);

/**
 * When the external provider does have coverage, the plugin should query it
 * (`getEvents`) instead of relying solely on Subsquid/RPC.
 */
test("plugin-sync queries the external provider when it has coverage", async () => {
    if (!INTEGRATION) {
        console.warn("Skipping integration test. Set INTEGRATION=1 to run.");

        return;
    }

    let getEventsCalls = 0;
    const emptyCoverageProvider: ExternalSyncProvider = {
        // eslint-disable-next-line require-yield
        streamEvents: async function* () {
            getEventsCalls++;
            // No events to yield: proves the call happened without needing to
            // fabricate real RailgunSmartWallet log payloads.
        },
        firstCoveredBlock: async () => "0x0",
        // Must overlap the sync range (pool registration → head): ChainedSyncer
        // skips any syncer whose latest covered block precedes the range, so
        // "0x0" coverage is correctly never queried. u64::MAX overlaps any chain.
        lastCoveredBlock: async () => "0xffffffffffffffff",
    };

    const plugin = await createRailgunPlugin(buildHost(emptyCoverageProvider), { rpcBatchSize: 10_000 });
    const bal = await plugin.balance(undefined);

    expect(getEventsCalls).toBeGreaterThan(0);
    expect(bal).toBeDefined();
}, 300 * 1000);
