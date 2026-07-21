/**
 * Privacy Pools v2 × Kohaku — LIVE Sepolia walkthrough.
 *
 * Same integration surface as the offline demo (`src/devnet-main.ts`), but the chain
 * is real: registration and deposits are signed with your key, broadcast over
 * RPC, verified by the deployed contracts (real Groth16 deposit proof), and
 * rediscovered by the plugin's sync from real chain events.
 *
 * Configure via `.env` (see `.env.example`):
 *   SEPOLIA_PRIVATE_KEY  funded key (REQUIRED — never commit this)
 *   SEPOLIA_RPC_URL      default: https://sepolia.drpc.org
 *   DEPOSIT_WEI          default: 1000
 *   CIRCUITS_DIR         default: <v2-monorepo>/packages/circuits/build
 *   SYNC_FROM_BLOCK      first-run scan start; default: current head − 100
 *                        (set to the deployment block, 10932482, to rescan an
 *                        account that already has deposits)
 *
 * Services: the REAL 0xbow staging ASP (api-dev.0xbow.io, pinned pubkey) and
 * staging relayer are wired as production config — deposits are screened by
 * the actual ASP and become spendable once approved; withdrawals relay
 * through the actual relayer (set WITHDRAW_WEI). The only dev seam left is
 * local proving (`live-seams.ts`).
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    createPPv2Broadcaster,
    createPPv2Plugin,
    type PPv2AccountId,
    type PPv2Instance,
} from "@kohaku-eth/privacy-pools";
import type { PPv2PluginParameters } from "@kohaku-eth/privacy-pools";
import { viem } from "@kohaku-eth/provider/viem";
import type { Address, Hex } from "viem";
import { createPublicClient, formatEther, http } from "viem";
import { CIRCUIT_MANIFEST } from "./wallet/config";
import { createWalletHost } from "./wallet/host";
import { PrivateKeyKeystore } from "./wallet/keystore";
import { createFileStorage } from "./live/file-storage";
import { createLocalProofService } from "./live/live-seams";
import { LiveWallet } from "./live/live-wallet";

const CHAIN_ID = 11155111n;

/**
 * V2 Sepolia deployment (proxies). Matches the SDK's `DEPLOYMENTS[11155111]`
 * defaults — kept explicit so this runner pins its deployment even if the SDK
 * map moves.
 */
const DEPLOYMENT = {
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
const DEPLOYMENT_BLOCK = 10_932_482n;

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
    processorAddress: "0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e",
};

const etherscan = (hash: string): string => `https://sepolia.etherscan.io/tx/${hash}`;

function step(title: string): void {
    console.log(`\n=== ${title} ===`);
}

async function printHoldings(plugin: PPv2Instance): Promise<void> {
    const balances = await plugin.balance(undefined);
    const spendable = balances.find((b) => b.tag === "spendable")?.amount ?? 0n;
    const unspendable = balances.find((b) => b.tag === "unspendable")?.amount ?? 0n;

    console.log(`  pool balance (native): spendable=${spendable} wei, unspendable=${unspendable} wei`);

    for (const note of (await plugin.notes?.(undefined, true)) ?? []) {
        console.log(
            `  note ${note.commitment.slice(0, 10)}… value=${note.value} status=${note.status} label=${note.labelState}`,
        );
    }
}

async function main(): Promise<void> {
    // ---- configuration ---------------------------------------------------
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
    const depositWei = BigInt(process.env["DEPOSIT_WEI"] ?? "1000");
    const here = dirname(fileURLToPath(import.meta.url));
    const circuitsDir = process.env["CIRCUITS_DIR"]
        ? resolve(process.env["CIRCUITS_DIR"])
        : join(here, "../../../../..", "0xbow/v2-monorepo/packages/circuits/build");

    if (!existsSync(join(circuitsDir, "deposit", "groth16_pkey.zkey"))) {
        console.error(
            `No circuit artifacts at ${circuitsDir} — set CIRCUITS_DIR to the v2-monorepo's packages/circuits/build.`,
        );
        process.exit(1);
    }

    // ---- wallet + host ----------------------------------------------------
    step("1. Wallet + host against live Sepolia");

    // READ_ONLY=1: construct + sync + read against the live chain, send nothing.
    const readOnly = process.env["READ_ONLY"] === "1";
    const wallet = new LiveWallet(privateKey, rpcUrl);
    const funds = await wallet.balance();

    console.log(`  owner ${wallet.ownerAddress} — ${formatEther(funds)} ETH on Sepolia`);

    if (funds === 0n && !readOnly) {
        console.error("  The account has no Sepolia ETH; fund it and re-run.");
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
    const storage = createFileStorage(join(here, "../.ppv2-live-store.json"));

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
            console.log("  note: deep SYNC_FROM_BLOCK — the first sync may take many minutes");
        }

        await storage.set(
            stateKey,
            JSON.stringify({ notes: [], syncCursor: `0x${fromBlock.toString(16)}` }),
        );
        console.log(`  seeded first sync at block ${fromBlock} (head: ${head})`);
    }

    // Pre-seed the revocable-key rotation index at 0 — correct for any account
    // that never rotated (this demo never does). Without a persisted index, a
    // registered account triggers the SDK's fresh-device gap scan, whose
    // `getCurrentAuthorizerDigest` reads AuthPolicySet logs FROM GENESIS
    // (~15 min through a public RPC — SDK issue worth an upstream fromBlock
    // hint). Set FULL_KEY_SCAN=1 to run the real scan instead.
    const recordKey = `ppv2:keystore:${CHAIN_ID}:${wallet.ownerAddress.toLowerCase()}`;

    if (process.env["FULL_KEY_SCAN"] !== "1" && (await storage.get(recordKey)) === null) {
        await storage.set(recordKey, JSON.stringify({ version: 1, revocableKeyIndex: "0x0" }));
    }

    // ---- plugin ------------------------------------------------------------
    // Production wiring: real ASP (pinned pubkey) and real relayer — the plugin
    // builds its own HTTP clients for both. Only proving is a factory seam.
    const params: PPv2PluginParameters = {
        chainId: CHAIN_ID,
        ownerAddress: wallet.ownerAddress,
        deployment: DEPLOYMENT as PPv2PluginParameters["deployment"],
        // No publicKey: the SDK's ASPClient fetches it from the ASP itself.
        asp: { baseUrl: process.env["ASP_URL"] ?? ASP_BASE_URL },
        relayers: [STAGING_RELAYER as PPv2PluginParameters["relayers"][number]],
        // Never fetched — the injected proofService loads local artifacts — but
        // the builder schema requires a gateway URL and non-empty manifest CIDs.
        artifacts: {
            gatewayUrls: ["https://ipfs.unavailable.invalid/ipfs"],
            manifest: CIRCUIT_MANIFEST,
        },
        factories: {
            proofService: createLocalProofService(circuitsDir),
        },
    };

    const plugin = await createPPv2Plugin(host, params);

    console.log(`  plugin instance for owner ${await plugin.instanceId()}`);

    // ---- registration -------------------------------------------------------
    step("2. Keystore registration (one-time, on-chain)");

    if (await plugin.isRegistered()) {
        console.log("  already registered — skipping");
    } else if (readOnly) {
        console.log("  not registered (READ_ONLY: not sending the registration)");
    } else {
        const op = await plugin.prepareRegisterKeystore();

        console.log(`  sending ${op.txs.length} registration txs (setAuthPolicy, setViewingKey)…`);

        const hashes = await wallet.sendPublicOperation(op);

        for (const hash of hashes) console.log(`  ✓ ${etherscan(hash)}`);
    }

    // ---- ragequit (optional) --------------------------------------------------
    // RAGEQUIT=all exits every held note publicly (full value back to the
    // owner, no ASP involvement) — the escape hatch for notes whose label the
    // ASP never approved. Real ragequit proof per note.
    if (process.env["RAGEQUIT"] === "all" && !readOnly) {
        step("R. Ragequit all held notes (public exit, full value to owner)");
        await plugin.sync();

        const held = (await plugin.notes?.()) ?? [];

        if (held.length === 0) console.log("  no notes to exit");

        for (const note of held) {
            console.log(`  proving ragequit for ${note.commitment.slice(0, 10)}… (${note.value} wei)`);

            const op = await plugin.prepareRageQuit(note.commitment as Hex);
            const hashes = await wallet.sendPublicOperation(op);

            for (const hash of hashes) console.log(`  ✓ ragequit: ${etherscan(hash)}`);
        }
    }

    // ---- shield --------------------------------------------------------------
    if (readOnly) {
        step("3. Sync + read back from real chain events (READ_ONLY)");
        await plugin.sync();
        await printHoldings(plugin);
        console.log("\nREAD_ONLY validation complete — nothing was sent.");

        return;
    }

    if (depositWei > 0n) {
        step(`3. Shield ${depositWei} wei (real Groth16 deposit proof + on-chain verify)`);

        const shield = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: depositWei,
        });

        console.log("  proof ready; broadcasting deposit…");

        const depositHashes = await wallet.sendPublicOperation(shield);

        for (const hash of depositHashes) console.log(`  ✓ deposit: ${etherscan(hash)}`);
    }

    // ---- read back -------------------------------------------------------------
    step("4. Sync + read back (chain events + live ASP label status)");
    await plugin.sync();
    await printHoldings(plugin);
    console.log(
        "  a fresh deposit stays unspendable until the ASP screens and approves its label —",
    );
    console.log("  re-run later to see it flip to spendable.");

    // ---- optional private transfer ---------------------------------------------
    // Set TRANSFER_WEI + TRANSFER_TO to send privately through the live relayer
    // (cold-start: the recipient needs no prior registration; their note travels
    // in the printed payload). Needs an ASP-approved note covering amount + fee.
    const transferWei = process.env["TRANSFER_WEI"];

    if (transferWei) {
        const recipient = process.env["TRANSFER_TO"] as PPv2AccountId | undefined;

        if (!recipient) throw new Error("TRANSFER_WEI set but TRANSFER_TO missing");

        step(`T. Private transfer: ${transferWei} wei → ${recipient} via the live relayer`);

        // Warm-up pass: the staging relayer's fee commitments expire 60s after
        // quoting, and a cold prepare (tree-leaf scans + artifact load + proof)
        // exceeds that. Run prepare once to fill the log/artifact caches, then
        // prepare fresh and broadcast immediately so quote→relay fits the TTL.
        console.log("  warm-up prepare (fills leaf-scan + circuit caches)…");
        await plugin.prepareTransfer(
            { asset: { __type: "native" }, amount: BigInt(transferWei) },
            recipient,
        );

        console.log("  hot prepare + relay…");

        const op = await plugin.prepareTransfer(
            { asset: { __type: "native" }, amount: BigInt(transferWei) },
            recipient,
        );

        const result = await createPPv2Broadcaster(plugin).broadcast(op);

        console.log(`  ✓ relayed transfer: ${etherscan(result.txHash)}`);
        console.log(`  cold-start payload for the recipient (deliver out-of-band):`);
        console.log(`  ${result.coldStartPayload}`);
        await printHoldings(plugin);
    }

    // ---- optional withdrawal ----------------------------------------------------
    // Set WITHDRAW_WEI (+ optional PAYOUT_ADDRESS) to unshield through the live
    // relayer. Needs an ASP-approved note covering amount + the relayer fee.
    const withdrawWei = process.env["WITHDRAW_WEI"];

    if (withdrawWei) {
        const payout = (process.env["PAYOUT_ADDRESS"] ?? wallet.ownerAddress) as Address;

        step(`5. Unshield ${withdrawWei} wei → ${payout} via the live relayer`);

        // Same warm-up rationale as the transfer step (60s fee-quote TTL).
        console.log("  warm-up prepare (fills leaf-scan + circuit caches)…");
        await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: BigInt(withdrawWei) },
            payout,
        );

        console.log("  hot prepare + relay…");

        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: BigInt(withdrawWei) },
            payout,
        );

        const result = await createPPv2Broadcaster(plugin).broadcast(op);

        console.log(`  ✓ relayed withdrawal: ${etherscan(result.txHash)}`);
        await printHoldings(plugin);
    }

    console.log("\nDone.");
}

main()
    .then(() => {
        // snarkjs leaves curve worker threads alive after proving; exit explicitly.
        process.exit(0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
