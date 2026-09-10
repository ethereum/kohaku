import net from "node:net";
import { Instance } from "prool";
import type { PublicClient } from "viem";

export const WALLET_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
export const DELEGATOR_PK = "0xd01165bc18d3f0d0b2114a42930164f729ae8310f447b4dd2e96124c02bbe151" as `0x${string}`;
export const ALTO_EXECUTOR_PK = "0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5" as `0x${string}`;
export const ALTO_UTILITY_PK = "0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6" as `0x${string}`;
export const ENTRY_POINT_08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as `0x${string}`;

const ALTO_BINARY = new URL("../../../node_modules/.bin/alto", import.meta.url).pathname;

// Probes the kernel for a free TCP port: bind port 0, take the assigned
// number, close. A tiny TOCTOU window exists between close and the node's
// bind, so pass an explicit port when determinism matters.
async function findFreePort(): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
            reject(new Error("Failed to probe for a free port"));
            return;
        }
        server.close(() => resolve(address.port));
    });
    return promise;
}

// Vitest runs test files in parallel, so callers must not assume prool's
// shared default ports (anvil 8545 / alto 3000) — when `port` is omitted a
// free one is probed instead, so each node gets a unique port.
export async function startAnvil(forkUrl: string, chainId: number, port?: number) {
    port ??= await findFreePort();
    const server = Instance.anvil({ forkUrl, chainId, port });
    await server.start();
    return { server, rpcUrl: `http://127.0.0.1:${server.port}` };
}

export async function fundAddresses(
    publicClient: PublicClient,
    addresses: `0x${string}`[],
    amount = 1_000n * 10n ** 18n,
): Promise<void> {
    const amountHex = `0x${amount.toString(16)}`;
    for (const address of addresses) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (publicClient as any).request({
            method: "anvil_setBalance",
            params: [address, amountHex],
        });
    }
}

export async function startAlto(rpcUrl: string, port?: number) {
    port ??= await findFreePort();
    const server = Instance.alto({
        binary: ALTO_BINARY,
        port,
        rpcUrl,
        entrypoints: [ENTRY_POINT_08],
        executorPrivateKeys: [ALTO_EXECUTOR_PK],
        utilityPrivateKey: ALTO_UTILITY_PK,
        safeMode: false,
    });
    await server.start();
    return server;
}
