/**
 * LIVE MODE — shared session builder for the `checks/` scripts: env parsing,
 * wallet, RPC wrapper (log-scan throttling/caching + pre-deployment
 * short-circuit), persistent storage, plugin parameters, and plugin
 * construction against the real V2 Sepolia deployment, the real 0xbow staging
 * ASP and relayer. Proving artifacts fetch from IPFS by default; set
 * CIRCUITS_DIR to prove from a local v2-monorepo circuits build instead.
 *
 * Configure via `.env` (see `.env.example`).
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPPv2Plugin, type PPv2Instance } from "@kohaku-eth/privacy-pools";
import type { PPv2PluginParameters } from "@kohaku-eth/privacy-pools";
import type { Storage as PluginStorage } from "@kohaku-eth/plugins";
import { viem } from "@kohaku-eth/provider/viem";
import type { Hex } from "viem";
import { createPublicClient, formatEther, http } from "viem";
import { CIRCUIT_MANIFEST } from "../wallet/config";
import { createWalletHost } from "../wallet/host";
import { PrivateKeyKeystore } from "../wallet/keystore";
import { createFileStorage } from "./file-storage";
import { createLocalProofService } from "./live-seams";
import { LiveWallet } from "./live-wallet";

export const CHAIN_ID = 11155111n;

/**
 * V2 Sepolia deployment (proxies). Matches the SDK's `DEPLOYMENTS[11155111]`
 * defaults — kept explicit so the checks pin their deployment even if the SDK
 * map moves.
 */
export const DEPLOYMENT = {
    poolAddress: "0x09b94d3127019298757A6ceeB7911922085f7C01",
    entrypointAddress: "0xEB3e3961008952348445513e418ad6F43C23ca9a",
    keystoreAddress: "0x6d264aCb9C3A7A3105c29470AfE2F5F1EC203C73",
    aspRegistryAddress: "0x35D29EFDCf067599ab4A53cf40229477f0b1cA9c",
} as const;

/**
 * The 0xbow staging ASP serving this deployment. No pinned public key: the
 * SDK's ASPClient fetches it from GET /public-key at deposit time (and
 * anchors ASP leaves against the on-chain `latestASPRoot`).
 */
const ASP_BASE_URL = "https://api-dev.0xbow.io";

/**
 * Entrypoint proxy creation block. Nothing protocol-relevant exists before
 * it, so the provider wrapper answers pre-deployment `eth_getLogs` windows
 * with `[]` locally — several SDK paths (keystore leaves, state leaves,
 * purge fallback) scan from genesis otherwise (~2,250 RPC calls each).
 */
export const DEPLOYMENT_BLOCK = 10_932_482n;

/**
 * The 0xbow staging relayer for this deployment. Its EOA (`address`) is the
 * observed `relay()` caller on the PrivacyPoolRelay processor contract.
 */
const STAGING_RELAYER = {
    url: "https://relayer-v2-staging-149184580131.us-east1.run.app",
    name: "0xbow-staging",
    chainId: 11155111,
    chainType: "evm",
    status: "active",
    address: "0x4Ba5fF376865b370790A56276C63e7984DCFf1f7",
    // The proof binds `processor` into its context, and the staging relayer
    // submits the two operations differently, so the right binding is
    // PER-OPERATION (verified against the relayer's actual on-chain calls):
    //   - transfers are submitted DIRECTLY from the relayer's EOA (0x4Ba5…,
    //     the default below);
    //   - withdrawals route through PrivacyPoolRelay (0x762665…, msg.sender
    //     of PoolVault.transact) — the unshield check overrides with it.
    // RelayerInfo has a single processorAddress — an SDK/relayer contract gap
    // reported upstream.
    processorAddress: "0x4Ba5fF376865b370790A56276C63e7984DCFf1f7",
};

export type LiveSession = {
    plugin: PPv2Instance;
    wallet: LiveWallet;
    storage: PluginStorage;
    ownerAddress: string;
};

export type LiveSessionOptions = {
    /** Exit early when the wallet holds no ETH (default true — checks send txs). */
    requireFunds?: boolean;
    /**
     * Storage override. Default: the shared `.ppv2-live-store.json` file at the
     * app root. Pass a fresh in-memory store to simulate a new device.
     */
    storage?: PluginStorage;
    /** Override the processor bound into proof contexts (see STAGING_RELAYER). */
    processorAddress?: string;
};

/** Build the live plugin session the checks share. */
export async function createLiveSession(options: LiveSessionOptions = {}): Promise<LiveSession> {
    // ---- configuration -----------------------------------------------------
    const privateKey = (process.env["SEPOLIA_PRIVATE_KEY"] ?? process.env["PRIVATE_KEY"]) as
        | Hex
        | undefined;

    if (!privateKey?.startsWith("0x")) {
        console.error(
            "Set SEPOLIA_PRIVATE_KEY in examples/ppv2-sample-app/.env (a funded Sepolia key, 0x-prefixed).",
        );
        process.exit(1);
    }

    const rpcUrl =
        process.env["SEPOLIA_RPC_URL"] ?? process.env["RPC_URL"] ?? "https://sepolia.drpc.org";
    const here = dirname(fileURLToPath(import.meta.url));
    // Proving artifacts come from IPFS by default (fetched + digest-checked
    // against the pinned manifest, FR-040). CIRCUITS_DIR opts into local
    // proving from a v2-monorepo circuits build — faster for iteration, since
    // the SDK re-fetches the multi-MB proving keys on every run.
    const circuitsDir = process.env["CIRCUITS_DIR"] ? resolve(process.env["CIRCUITS_DIR"]) : null;

    if (circuitsDir && !existsSync(join(circuitsDir, "deposit", "groth16_pkey.zkey"))) {
        console.error(
            `No circuit artifacts at ${circuitsDir} — unset CIRCUITS_DIR (IPFS artifacts) or point it at the v2-monorepo's packages/circuits/build.`,
        );
        process.exit(1);
    }

    // ---- wallet --------------------------------------------------------------
    const wallet = new LiveWallet(privateKey, rpcUrl);
    const funds = await wallet.balance();

    console.log(`owner ${wallet.ownerAddress} — ${formatEther(funds)} ETH on Sepolia`);

    if (funds === 0n && (options.requireFunds ?? true)) {
        console.error("The account has no Sepolia ETH; fund it and re-run.");
        process.exit(1);
    }

    const publicClient = createPublicClient({
        transport: http(rpcUrl, { timeout: 30_000, retryCount: 3 }),
    });
    // Dedicated endpoint for log scans: free-tier keys often cap eth_getLogs
    // to tiny block ranges (Alchemy free: 10 blocks), which explodes the SDK's
    // 5000-block windows into thousands of bisected calls. drpc serves full
    // ranges on its public tier.
    const logsClient = createPublicClient({
        transport: http(process.env["LOGS_RPC_URL"] ?? "https://sepolia.drpc.org", {
            timeout: 30_000,
            retryCount: 2,
        }),
    });
    const storage = options.storage ?? createFileStorage(join(here, "../../.ppv2-live-store.json"));

    // Real fetch for the plugin's ASP/relayer clients, with a hard timeout so a
    // hung endpoint fails loudly instead of stalling forever. LIVE_TRACE=1 logs
    // every HTTP and RPC call.
    const trace = process.env["LIVE_TRACE"] === "1";
    const tracedFetch: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (trace) console.error(`[live] fetch ${url}`);

        const response = await fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(60_000),
        });

        // Surface error bodies — SDK errors carry only the HTTP status, which
        // hides the service's actual complaint.
        if (!response.ok) {
            const body = await response.clone().text();

            console.error(`[live] ${response.status} from ${url}: ${body.slice(0, 500)}`);

            // LIVE_DUMP=1: persist the full relay request/response pair for
            // offline diffing (e.g. proof-context mismatches).
            if (process.env["LIVE_DUMP"] === "1" && url.includes("/relay/")) {
                const { writeFileSync } = await import("node:fs");

                writeFileSync("/tmp/relay-request.json", String(init?.body ?? ""));
                writeFileSync("/tmp/relay-response.json", body);
                console.error("[live] dumped relay request/response to /tmp/relay-*.json");
            }
        }

        return response;
    };
    const baseProvider = viem(publicClient);
    // Serialize eth_getLogs with a small gap (leaf scans fire dozens
    // back-to-back and trip free-tier RPC rate limits) and retry transient
    // failures with backoff — a failed window otherwise sends the SDK's
    // bisection into single-block requests until one hard-fails.
    const logsCache = new Map<string, unknown>();
    let logsGate: Promise<unknown> = Promise.resolve();
    const throttledLogs = (call: () => Promise<unknown>): Promise<unknown> => {
        const run = logsGate.then(async () => {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await call();
                } catch (err) {
                    // Deterministic provider-policy errors (e.g. "block range
                    // too large") must fail fast so the SDK's window bisection
                    // proceeds — retrying them only adds backoff latency.
                    const message = err instanceof Error ? err.message : String(err);

                    if (attempt >= 3 || /block range|-32600/i.test(message)) throw err;

                    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
                }
            }
        });

        logsGate = run.then(
            () => new Promise((r) => setTimeout(r, 50)),
            () => new Promise((r) => setTimeout(r, 50)),
        );

        return run;
    };
    const provider = new Proxy(baseProvider, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);

            if (prop === "request" && typeof value === "function") {
                return async (req: { method: string; params?: unknown[] }) => {
                    const call = () =>
                        (value as (r: unknown) => Promise<unknown>).call(target, req);

                    if (trace) {
                        console.error(
                            `[live] rpc ${req.method} ${JSON.stringify(req.params?.[0] ?? "").slice(0, 120)}`,
                        );
                    }

                    if (req.method !== "eth_getLogs") return call();

                    // Answer pre-deployment log windows locally — the contracts
                    // did not exist, so the result is [] by construction.
                    const filter = (req.params?.[0] ?? {}) as { toBlock?: string };

                    if (
                        filter.toBlock &&
                        filter.toBlock !== "latest" &&
                        BigInt(filter.toBlock) < DEPLOYMENT_BLOCK
                    ) {
                        return [];
                    }

                    // Log scans go to the dedicated wide-range endpoint. Cache
                    // identical requests for the run: witness building scans
                    // the same historical windows on every prepare/broadcast,
                    // and the staging relayer's fee quotes expire in 60s — the
                    // quote→relay path must run on warm caches to fit.
                    const cacheKey = JSON.stringify(req.params);
                    const cached = logsCache.get(cacheKey);

                    if (cached) return structuredClone(cached);

                    const result = await throttledLogs(() => logsClient.request(req as never));

                    logsCache.set(cacheKey, result);

                    return structuredClone(result);
                };
            }

            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const host = {
        ...createWalletHost({ mnemonic: "unused", provider, fetchImpl: tracedFetch }),
        keystore: new PrivateKeyKeystore(privateKey),
        storage,
    };

    // First run only: seed the note-discovery cursor (the SDK persists it under
    // this key afterwards). Default: just behind the current head — correct for
    // an account with no prior PPv2 activity, and it avoids a ~300k-block
    // history scan through a rate-limited public RPC. An account with existing
    // deposits must set SYNC_FROM_BLOCK (the deployment block is 10932482).
    const stateKey = `ppv2:v1:note-manager-state:${CHAIN_ID}:${wallet.ownerAddress.toLowerCase()}`;

    if ((await storage.get(stateKey)) === null) {
        const head = await publicClient.getBlockNumber();
        const fromBlock = process.env["SYNC_FROM_BLOCK"]
            ? BigInt(process.env["SYNC_FROM_BLOCK"])
            : head - 100n;

        if (fromBlock < head - 10_000n) {
            console.log("note: deep SYNC_FROM_BLOCK — the first sync may take many minutes");
        }

        await storage.set(
            stateKey,
            JSON.stringify({ notes: [], syncCursor: `0x${fromBlock.toString(16)}` }),
        );
        console.log(`seeded first sync at block ${fromBlock} (head: ${head})`);
    }

    // Pre-seed the revocable-key rotation index at 0 — correct for any account
    // that never rotated (these checks never do). Without a persisted index, a
    // registered account triggers the SDK's fresh-device gap scan, whose
    // `getCurrentAuthorizerDigest` reads AuthPolicySet logs FROM GENESIS
    // (~15 min through a public RPC — SDK issue worth an upstream fromBlock
    // hint). Set FULL_KEY_SCAN=1 to run the real scan instead.
    const recordKey = `ppv2:keystore:${CHAIN_ID}:${wallet.ownerAddress.toLowerCase()}`;

    if (process.env["FULL_KEY_SCAN"] !== "1" && (await storage.get(recordKey)) === null) {
        await storage.set(recordKey, JSON.stringify({ version: 1, revocableKeyIndex: "0x0" }));
    }

    // ---- plugin --------------------------------------------------------------
    // Production wiring: real ASP (pinned pubkey) and real relayer — the plugin
    // builds its own HTTP clients for both. Only proving is a factory seam.
    const params: PPv2PluginParameters = {
        chainId: CHAIN_ID,
        ownerAddress: wallet.ownerAddress,
        deployment: DEPLOYMENT as PPv2PluginParameters["deployment"],
        // No publicKey: the SDK's ASPClient fetches it from the ASP itself.
        asp: { baseUrl: process.env["ASP_URL"] ?? ASP_BASE_URL },
        relayers: [
            {
                ...STAGING_RELAYER,
                processorAddress: options.processorAddress ?? STAGING_RELAYER.processorAddress,
            } as PPv2PluginParameters["relayers"][number],
        ],
        artifacts: {
            // The SDK's default gateway plus a public fallback; every gateway's
            // bytes are digest-checked against the pinned manifest.
            gatewayUrls: ["https://ipfs.io/ipfs", "https://dweb.link/ipfs"],
            manifest: CIRCUIT_MANIFEST,
        },
        // CIRCUITS_DIR set: local-proving seam instead of IPFS fetches.
        ...(circuitsDir
            ? { factories: { proofService: createLocalProofService(circuitsDir) } }
            : {}),
    };

    const plugin = await createPPv2Plugin(host, params);

    return { plugin, wallet, storage, ownerAddress: wallet.ownerAddress };
}
