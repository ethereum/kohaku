/**
 * Sepolia integration tests for the Curvy Kohaku plugin.
 *
 * Reads config from environment variables (loaded from .env via `process.loadEnvFile()`):
 *   - SEPOLIA_RPC_URL:          JSON-RPC endpoint for Ethereum Sepolia
 *   - CURVY_API_BASE_URL:       Curvy backend base URL (public testnet or self-hosted pointed at Sepolia)
 *   - SEPOLIA_RECIPIENT:        Recipient EVM address for unshield test
 *   - SEPOLIA_FUNDER_PRIVATE_KEY: 0x-prefixed 32-byte private key of an account with Sepolia ETH
 *                                (used to fund the shield portal address with a real signed tx)
 *
 * Run with:  node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/plugin.sepolia.test.ts
 * Or add a package.json script: "test:sepolia": "node --env-file=.env node_modules/.bin/vitest run tests/plugin.sepolia.test.ts"
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as Secp256k1 from "ox/Secp256k1";
import * as OxAddress from "ox/Address";
import * as TxEnvelopeEip1559 from "ox/TxEnvelopeEip1559";
import type { Hex } from "ox/Hex";
import type { EvmSignatureData, CurvyId } from "@0xcurvy/curvy-sdk";
import type { Host } from "@kohaku-eth/plugins";
import { createCurvyPlugin, type CurvyPlugin, type CurvyPublicOperation } from "../src/plugin.js";

// ---------------------------------------------------------------------------
// Config (from env)

const SEPOLIA_RPC_URL = requireEnv("SEPOLIA_RPC_URL");
const API_BASE_URL = requireEnv("CURVY_API_BASE_URL");
const RECIPIENT = requireEnv("SEPOLIA_RECIPIENT") as `0x${string}`;
const FUNDER_PK = requireEnv("SEPOLIA_FUNDER_PRIVATE_KEY") as Hex;

const SEPOLIA_CHAIN_ID = 11155111n;

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

// ---------------------------------------------------------------------------
// Test Curvy keys (BabyJubJub, not EVM)

const TEST_S = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const TEST_V = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const TEST_S2 = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const TEST_V2 = "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex;

// ---------------------------------------------------------------------------
// Host mocks

function makeHost(sKey: Hex, vKey: Hex): Host {
    const storageMap = new Map<string, string>();
    return {
        keystore: {
            deriveAt: (path: string): Hex => (path.includes("/0'/") ? sKey : vKey),
        },
        storage: {
            _brand: "Storage" as const,
            get: (key: string) => storageMap.get(key) ?? null,
            set: (key: string, value: string) => { storageMap.set(key, value); },
        },
        network: {
            fetch: (input, init) => fetch(input, init),
        },
        provider: {
            getChainId: async (): Promise<bigint> => SEPOLIA_CHAIN_ID,
        } as never,
    };
}

const makeTestHost = () => makeHost(TEST_S, TEST_V);
const makeTestHost2 = () => makeHost(TEST_S2, TEST_V2);

// ---------------------------------------------------------------------------
// Fresh identities

let identityCounter = 0;
function freshIdentity(): { signingAddress: `0x${string}`; curvyId: CurvyId } {
    const privateKey = Secp256k1.randomPrivateKey();
    const publicKey = Secp256k1.getPublicKey({ privateKey });
    const signingAddress = OxAddress.fromPublicKey(publicKey);
    const suffix = Date.now().toString(36).slice(-8);
    // NOTE: adjust domain if the public testnet uses a different one.
    const curvyId = `t${suffix}${identityCounter++}.local-curvy.name` as CurvyId;
    return { signingAddress, curvyId };
}

function makeSignature(signingAddress: `0x${string}`): EvmSignatureData {
    return {
        signingAddress,
        signatureResult: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        signatureParams: {
            domain: { name: "Curvy Protocol", version: "1.0.0", chainId: 1 },
            message: { title: "test", content: "test" },
            primaryType: "AuthMessage",
            types: {
                EIP712Domain: [
                    { name: "name", type: "string" },
                    { name: "version", type: "string" },
                    { name: "chainId", type: "uint256" },
                ],
                AuthMessage: [
                    { name: "title", type: "string" },
                    { name: "content", type: "string" },
                ],
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Sepolia RPC helpers

async function sepoliaRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(SEPOLIA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`Sepolia RPC error (${method}): ${json.error.message}`);
    return json.result as T;
}

const FUNDER_PRIV = (FUNDER_PK.startsWith("0x") ? FUNDER_PK : `0x${FUNDER_PK}`) as Hex;
const FUNDER_PUB = Secp256k1.getPublicKey({ privateKey: FUNDER_PRIV });
const FUNDER_ADDRESS = OxAddress.fromPublicKey(FUNDER_PUB);

/**
 * Sign and broadcast an EIP-1559 tx from FUNDER_ADDRESS to `to` carrying `value` wei.
 * Waits for the tx to be mined before returning.
 */
async function fundPortal(to: string, value: bigint): Promise<void> {
    const [nonceHex, feeHistory, chainIdHex] = await Promise.all([
        sepoliaRpc<string>("eth_getTransactionCount", [FUNDER_ADDRESS, "pending"]),
        sepoliaRpc<{ baseFeePerGas: string[] }>("eth_feeHistory", ["0x1", "latest", []]),
        sepoliaRpc<string>("eth_chainId", []),
    ]);
    const baseFee = BigInt(feeHistory.baseFeePerGas.at(-1) ?? "0x0");
    const maxPriorityFeePerGas = 1_500_000_000n; // 1.5 gwei tip
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const envelope = TxEnvelopeEip1559.from({
        chainId: Number(BigInt(chainIdHex)),
        nonce: BigInt(nonceHex),
        to: to as `0x${string}`,
        value,
        gas: 21_000n,
        maxFeePerGas,
        maxPriorityFeePerGas,
    });
    const signature = Secp256k1.sign({
        payload: TxEnvelopeEip1559.getSignPayload(envelope),
        privateKey: FUNDER_PRIV,
    });
    const signed = TxEnvelopeEip1559.from(envelope, { signature });
    const raw = TxEnvelopeEip1559.serialize(signed);

    const txHash = await sepoliaRpc<string>("eth_sendRawTransaction", [raw]);

    // Wait for mining (max ~3 min on Sepolia).
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const rcpt = await sepoliaRpc<{ status?: string } | null>("eth_getTransactionReceipt", [txHash]);
        if (rcpt && rcpt.status === "0x1") return;
        if (rcpt && rcpt.status === "0x0") throw new Error(`Funding tx reverted: ${txHash}`);
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`Funding tx ${txHash} not mined within 180s`);
}

async function pollForNativeBalance(
    plugin: CurvyPlugin,
    minAmount: bigint,
    timeoutMs = 300_000,
    intervalMs = 5_000,
): Promise<bigint> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const balances = await plugin.balance([{ __type: "native" }]);
        const total = balances.reduce((sum, b) => sum + b.amount, 0n);
        if (total >= minAmount) return total;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Balance did not reach ${minAmount} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Tests

describe("Sepolia / Phase 1: Plugin creation and auth", () => {
    describe("Registration flow", () => {
        const { signingAddress, curvyId } = freshIdentity();
        let plugin: CurvyPlugin;

        beforeAll(async () => {
            plugin = await createCurvyPlugin(makeTestHost(), {
                signature: makeSignature(signingAddress),
                curvyId,
                apiBaseUrl: API_BASE_URL,
            });
        }, 60_000);

        it("returns a plugin instance", () => {
            expect(plugin).toBeDefined();
        });

        it("instanceId() returns the registered Curvy ID", async () => {
            expect(await plugin.instanceId()).toBe(curvyId);
        });
    });
});

describe("Sepolia / Phase 4: Shield flow", () => {
    const { signingAddress, curvyId } = freshIdentity();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
        });
    }, 60_000);

    it("prepareShield(nativeEth) returns a PublicOperation", async () => {
        const op: CurvyPublicOperation = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: 1_000_000_000_000_000n,
        });

        expect(op.__type).toBe("publicOperation");
        expect(op.txs.length).toBeGreaterThan(0);
        const tx = op.txs[0]!;
        expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(tx.data).toBe("0x");
        expect(tx.value).toBe(1_000_000_000_000_000n);
    }, 30_000);

    it("prepareShield(unsupportedAsset) throws UnsupportedAssetError", async () => {
        const { UnsupportedAssetError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareShield({
                asset: { __type: "erc20", contract: "0x0000000000000000000000000000000000000001" as const },
                amount: 1n,
            }),
        ).rejects.toBeInstanceOf(UnsupportedAssetError);
    }, 30_000);
});

describe("Sepolia / Phase 4: Shield E2E", () => {
    const SHIELD_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH
    const { signingAddress, curvyId } = freshIdentity();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
        });
    }, 60_000);

    it("balance() reflects shielded ETH after backend processing", async () => {
        const shieldOp = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });
        await fundPortal(shieldOp.txs[0]!.to, SHIELD_AMOUNT);
        const finalBalance = await pollForNativeBalance(plugin, SHIELD_AMOUNT / 100n * 90n, 420_000);
        expect(finalBalance).toBeGreaterThanOrEqual(SHIELD_AMOUNT / 100n * 90n);
    }, 600_000);
});

describe("Sepolia / Phase 5: Transfer E2E", () => {
    const SHIELD_AMOUNT = 1_000_000_000_000_000n;
    const TRANSFER_AMOUNT = 500_000_000_000_000n;

    const { signingAddress: senderSigner, curvyId: senderCurvyId } = freshIdentity();
    const { signingAddress: recipientSigner, curvyId: recipientCurvyId } = freshIdentity();

    let senderPlugin: CurvyPlugin;
    let recipientPlugin: CurvyPlugin;
    let balanceBeforeTransfer: bigint;
    let balanceAfterTransfer: bigint;

    beforeAll(async () => {
        senderPlugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(senderSigner),
            curvyId: senderCurvyId,
            apiBaseUrl: API_BASE_URL,
        });
        recipientPlugin = await createCurvyPlugin(makeTestHost2(), {
            signature: makeSignature(recipientSigner),
            curvyId: recipientCurvyId,
            apiBaseUrl: API_BASE_URL,
        });

        const shieldOp = await senderPlugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });
        await fundPortal(shieldOp.txs[0]!.to, SHIELD_AMOUNT);

        balanceBeforeTransfer = await pollForNativeBalance(senderPlugin, TRANSFER_AMOUNT, 420_000);

        const op = await senderPlugin.prepareTransfer(
            { asset: { __type: "native" }, amount: TRANSFER_AMOUNT },
            recipientCurvyId,
        );
        await senderPlugin.broadcast(op);

        const balancesAfter = await senderPlugin.balance([{ __type: "native" }]);
        balanceAfterTransfer = balancesAfter.reduce((sum, b) => sum + b.amount, 0n);
    }, 900_000);

    it("sender balance decreases after transfer", () => {
        expect(balanceAfterTransfer).toBeLessThan(balanceBeforeTransfer);
    });

    it("recipient private balance increases after transfer", async () => {
        const deadline = Date.now() + 60_000;
        let recipientTotal = 0n;
        while (Date.now() < deadline) {
            const balances = await recipientPlugin.balance([{ __type: "native" }]);
            recipientTotal = balances.reduce((sum, b) => sum + b.amount, 0n);
            if (recipientTotal > 0n) break;
            await new Promise((r) => setTimeout(r, 5_000));
        }
        expect(recipientTotal).toBeGreaterThan(0n);
    }, 90_000);
});

describe("Sepolia / Phase 6: Unshield E2E", () => {
    const SHIELD_AMOUNT = 1_000_000_000_000_000n;
    const UNSHIELD_AMOUNT = 500_000_000_000_000n;

    const { signingAddress, curvyId } = freshIdentity();
    let plugin: CurvyPlugin;
    let balanceBeforeUnshield: bigint;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
        });

        const shieldOp = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });
        await fundPortal(shieldOp.txs[0]!.to, SHIELD_AMOUNT);

        balanceBeforeUnshield = await pollForNativeBalance(plugin, SHIELD_AMOUNT / 100n * 90n, 420_000);
    }, 600_000);

    it("prepareUnshield returns a CurvyPrivateOperation with an EstimatedPlan", async () => {
        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: UNSHIELD_AMOUNT },
            RECIPIENT,
        );
        expect(op.__type).toBe("privateOperation");
        expect(op.estimatedPlan).toBeDefined();
    }, 60_000);

    it("broadcast(unshieldOp) executes and private balance decreases", async () => {
        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: UNSHIELD_AMOUNT },
            RECIPIENT,
        );
        await plugin.broadcast(op);

        const balancesAfterUnshield = await plugin.balance([{ __type: "native" }]);
        const totalAfter = balancesAfterUnshield.reduce((sum, b) => sum + b.amount, 0n);
        expect(totalAfter).toBeLessThan(balanceBeforeUnshield + UNSHIELD_AMOUNT);
    }, 600_000);
});
