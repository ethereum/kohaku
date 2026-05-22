import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, test } from "vitest";
import { MemoryStorage, MnemonicKeystore, type Host } from "@kohaku-eth/plugins";
import { chainConfigSepolia, ensureInitialized, initLogging } from "../sdk/lib.js";
import { createRailgunPlugin } from "../sdk/plugin.js";
import { viem } from "@kohaku-eth/provider/viem";
import { startAnvil } from "./utils.js";

await ensureInitialized();
initLogging("Info");
const CHAIN = chainConfigSepolia();
const INTEGRATION = process.env.INTEGRATION === "1";
const SEPOLIA_RPC_URL: string | undefined = process.env.RPC_URL_SEPOLIA;
if (!SEPOLIA_RPC_URL)
    throw new Error("RPC_URL_SEPOLIA env must be defined");

let rpcUrl: string;
let anvilServer: Awaited<ReturnType<typeof startAnvil>>["server"];

beforeAll(async () => {
    const anvil = await startAnvil(SEPOLIA_RPC_URL, CHAIN.id);
    anvilServer = anvil.server;
    rpcUrl = anvil.rpcUrl;
}, 60_000);

afterAll(async () => {
    await anvilServer?.stop();
});

/**
 * Tests a full plugin sync flow with PPOI enabled
 */
test("plugin-sync", async () => {
    console.log("Starting plugin sync test");
    if (!INTEGRATION) {
        console.warn("Skipping integration test. Set INTEGRATION=1 to run.");
        return;
    }

    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const eip1193 = viem(publicClient);

    const host: Host = {
        network: {
            fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                return fetch(input, init);
            }
        },
        storage: new MemoryStorage(),
        keystore: MnemonicKeystore.random(),
        provider: eip1193,
    };

    console.log("Creating plugin");
    const plugin = await createRailgunPlugin(host, { rpcBatchSize: 10_000 });

    console.log("Syncing Plugin");
    const bal = await plugin.balance(undefined);

    console.log("Plugin sync complete. Balance:", bal);
}, 300 * 1000);
