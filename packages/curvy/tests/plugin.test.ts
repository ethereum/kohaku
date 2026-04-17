/**
 * Integration tests for the Curvy Kohaku plugin (Phases 1–3).
 *
 * Requires a running Curvy backend (http://localhost:4000) and local chain (Anvil).
 * Start the devenv with `pnpm dev` from the Curvy monorepo before running these tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as Secp256k1 from "ox/Secp256k1";
import * as OxAddress from "ox/Address";
import type { Hex } from "ox/Hex";
import type { EvmSignatureData, CurvyId } from "@0xcurvy/curvy-sdk";
import type { Host } from "@kohaku-eth/plugins";
import { createCurvyPlugin, type CurvyPlugin, type CurvyPublicOperation } from "../src/plugin.js";
import { UnsupportedChainError } from "@kohaku-eth/plugins";

const API_BASE_URL = "http://localhost:4000";
const ENVIRONMENT = "testnet" as const;

// Fixed test spending/viewing private keys (arbitrary 32-byte hex values used as Curvy s/v keys).
// These are not EVM keys — they're BabyJubJub field inputs passed to core.getCurvyKeys.
const TEST_S = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const TEST_V = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;

// Second key pair — used for recipient wallet in transfer E2E tests so that
// sender and recipient have genuinely separate Curvy vaults.
const TEST_S2 = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
const TEST_V2 = "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex;

/**
 * Build a minimal Host mock for testing.
 * - keystore: returns TEST_S for spending path, TEST_V for viewing path
 * - storage: in-memory Map-backed key-value store
 * - network: passes through to global fetch
 * - provider: queries Anvil for chain ID
 */
function makeTestHost(): Host {
    const storageMap = new Map<string, string>();
    return {
        keystore: {
            deriveAt: (path: string): Hex => {
                // Spending path contains /0'/ (change index 0), viewing contains /1'/
                return path.includes("/0'/") ? TEST_S : TEST_V;
            },
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
            getChainId: async (): Promise<bigint> => {
                const res = await fetch(ANVIL_RPC, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
                });
                const json = await res.json() as { result: string };
                return BigInt(json.result);
            },
        } as never,
    };
}

/**
 * Host mock using the second key pair (TEST_S2 / TEST_V2).
 * Used to create a genuinely separate recipient wallet in E2E transfer tests.
 */
function makeTestHost2(): Host {
    const storageMap = new Map<string, string>();
    return {
        keystore: {
            deriveAt: (path: string): Hex => {
                return path.includes("/0'/") ? TEST_S2 : TEST_V2;
            },
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
            getChainId: async (): Promise<bigint> => {
                const res = await fetch(ANVIL_RPC, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
                });
                const json = await res.json() as { result: string };
                return BigInt(json.result);
            },
        } as never,
    };
}

/**
 * Host mock that reports an unsupported chain ID (9999).
 * Used to test UnsupportedChainError in Phase 7.
 */
function makeWrongChainHost(): Host {
    const storageMap = new Map<string, string>();
    return {
        keystore: {
            deriveAt: (path: string): Hex => path.includes("/0'/") ? TEST_S : TEST_V,
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
            getChainId: async (): Promise<bigint> => 9999n,
        } as never,
    };
}

/**
 * Generate a fresh ephemeral EVM identity per test run to avoid conflicts with
 * previously registered accounts on the devenv backend.
 */
let identityCounter = 0;
function freshIdentity(): { signingAddress: `0x${string}`; curvyId: CurvyId } {
    const privateKey = Secp256k1.randomPrivateKey();
    const publicKey = Secp256k1.getPublicKey({ privateKey });
    const signingAddress = OxAddress.fromPublicKey(publicKey);

    // Handle: 't' + timestamp + counter to guarantee uniqueness across calls
    // in the same millisecond. Domain '.local-curvy.name' is the devenv domain.
    const suffix = Date.now().toString(36).slice(-8);
    const curvyId = `t${suffix}${identityCounter++}.local-curvy.name` as CurvyId;

    return { signingAddress, curvyId };
}

// Minimal EvmSignatureData — signatureResult and signatureParams are not verified
// in the addWalletWithPrivateKeys / registerWalletWithPrivateKeys code path.
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

describe("Phase 1: Plugin creation, key derivation, and auth", () => {
    describe("Registration flow", () => {
        const { signingAddress, curvyId } = freshIdentity();
        const host = makeTestHost();
        let plugin: CurvyPlugin;

        beforeAll(async () => {
            plugin = await createCurvyPlugin(host, {
                signature: makeSignature(signingAddress),
                curvyId,
                apiBaseUrl: API_BASE_URL,
                environment: ENVIRONMENT,
            });
        }, 30_000);

        it("returns a plugin instance", () => {
            expect(plugin).toBeDefined();
            expect(typeof plugin.instanceId).toBe("function");
        });

        it("instanceId() returns the registered Curvy ID", async () => {
            const id = await plugin.instanceId();
            expect(id).toBe(curvyId);
        });
    });

    describe("Login flow", () => {
        // Use a separate identity so registration and login tests are independent.
        const { signingAddress, curvyId } = freshIdentity();
        const host = makeTestHost();
        let loginPlugin: CurvyPlugin;

        beforeAll(async () => {
            // Register first, then login in a second plugin creation.
            await createCurvyPlugin(host, {
                signature: makeSignature(signingAddress),
                curvyId,
                apiBaseUrl: API_BASE_URL,
                environment: ENVIRONMENT,
            });

            // Login: omit curvyId to trigger the login path.
            loginPlugin = await createCurvyPlugin(makeTestHost(), {
                signature: makeSignature(signingAddress),
                apiBaseUrl: API_BASE_URL,
                environment: ENVIRONMENT,
            });
        }, 30_000);

        it("returns a plugin instance on login", () => {
            expect(loginPlugin).toBeDefined();
        });

        it("instanceId() returns the previously registered Curvy ID after login", async () => {
            const id = await loginPlugin.instanceId();
            expect(id).toBe(curvyId);
        });
    });
});

describe("Phase 4: Shield flow", () => {
    const { signingAddress, curvyId } = freshIdentity();
    const host = makeTestHost();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(host, {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });
    }, 30_000);

    it("prepareShield(nativeEth) returns a PublicOperation with a value transfer", async () => {
        const op: CurvyPublicOperation = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: 1_000_000_000_000_000n, // 0.001 ETH
        });

        expect(op.__type).toBe("publicOperation");
        expect(Array.isArray(op.txs)).toBe(true);
        expect(op.txs.length).toBeGreaterThan(0);

        const tx = op.txs[0]!;
        // Portal address must be a valid hex address
        expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
        // Native ETH transfers carry the value, not calldata
        expect(tx.data).toBe("0x");
        expect(tx.value).toBe(1_000_000_000_000_000n);
    }, 15_000);

    it("prepareShield(unsupportedAsset) throws UnsupportedAssetError", async () => {
        const { UnsupportedAssetError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareShield({
                asset: { __type: "erc20", contract: "0x0000000000000000000000000000000000000001" as const },
                amount: 1n,
            }),
        ).rejects.toBeInstanceOf(UnsupportedAssetError);
    }, 15_000);
});

describe("Phase 3: Balance queries", () => {
    const { signingAddress, curvyId } = freshIdentity();
    const host = makeTestHost();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(host, {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });
    }, 30_000);

    it("balance(undefined) returns an AssetAmount array", async () => {
        const result = await plugin.balance(undefined);
        expect(Array.isArray(result)).toBe(true);
    }, 10_000);

    it("balance(undefined) entries have correct shape", async () => {
        const result = await plugin.balance(undefined);
        for (const entry of result) {
            expect(entry).toHaveProperty("asset");
            expect(entry).toHaveProperty("amount");
            expect(typeof entry.amount).toBe("bigint");
            expect(["native", "erc20"]).toContain(entry.asset.__type);
        }
    }, 10_000);

    it("balance([]) returns empty array (no matching assets)", async () => {
        const result = await plugin.balance([]);
        expect(result).toEqual([]);
    }, 10_000);

    it("balance([nativeAsset]) filters to native ETH only", async () => {
        const result = await plugin.balance([{ __type: "native" }]);
        expect(Array.isArray(result)).toBe(true);
        for (const entry of result) {
            expect(entry.asset.__type).toBe("native");
        }
    }, 10_000);

    it("balance([unknownErc20]) returns empty array", async () => {
        const unknownToken = "0x0000000000000000000000000000000000000001" as const;
        const result = await plugin.balance([{ __type: "erc20", contract: unknownToken }]);
        expect(result).toEqual([]);
    }, 10_000);
});

describe("Phase 5: Transfer flow", () => {
    const { signingAddress, curvyId } = freshIdentity();
    const host = makeTestHost();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(host, {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });
    }, 30_000);

    it("prepareTransfer with invalid Curvy ID throws InvalidAddressError", async () => {
        const { InvalidAddressError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareTransfer(
                { asset: { __type: "native" }, amount: 1n },
                "not-a-valid-curvy-id" as never,
            ),
        ).rejects.toBeInstanceOf(InvalidAddressError);
    }, 10_000);

    it("prepareTransfer with unsupported asset throws UnsupportedAssetError", async () => {
        const { UnsupportedAssetError } = await import("@kohaku-eth/plugins");
        const { signingAddress: r2 } = freshIdentity();
        const recipientHost = makeTestHost();
        const { curvyId: recipientId } = freshIdentity();
        await createCurvyPlugin(recipientHost, {
            signature: makeSignature(r2),
            curvyId: recipientId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });

        await expect(
            plugin.prepareTransfer(
                { asset: { __type: "erc20", contract: "0x0000000000000000000000000000000000000001" as const }, amount: 1n },
                recipientId,
            ),
        ).rejects.toBeInstanceOf(UnsupportedAssetError);
    }, 30_000);

    it("prepareTransfer with zero balance throws InsufficientBalanceError", async () => {
        const { InsufficientBalanceError } = await import("@kohaku-eth/plugins");
        // Register a fresh recipient to transfer to
        const { signingAddress: recipientSigner, curvyId: recipientId } = freshIdentity();
        const recipientHost = makeTestHost();
        await createCurvyPlugin(recipientHost, {
            signature: makeSignature(recipientSigner),
            curvyId: recipientId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });

        // Fresh wallet with no balance — any non-zero transfer should fail
        await expect(
            plugin.prepareTransfer(
                { asset: { __type: "native" }, amount: 1_000_000_000_000_000n },
                recipientId,
            ),
        ).rejects.toBeInstanceOf(InsufficientBalanceError);
    }, 30_000);
});

describe("Phase 6: Unshield flow (prepareUnshield + broadcast)", () => {
    const { signingAddress, curvyId } = freshIdentity();
    const host = makeTestHost();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(host, {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });
    }, 30_000);

    it("prepareUnshield with invalid EVM address throws InvalidAddressError", async () => {
        const { InvalidAddressError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareUnshield(
                { asset: { __type: "native" }, amount: 1n },
                "not-an-address" as never,
            ),
        ).rejects.toBeInstanceOf(InvalidAddressError);
    }, 10_000);

    it("prepareUnshield with unsupported asset throws UnsupportedAssetError", async () => {
        const { UnsupportedAssetError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareUnshield(
                { asset: { __type: "erc20", contract: "0x0000000000000000000000000000000000000001" as const }, amount: 1n },
                "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const,
            ),
        ).rejects.toBeInstanceOf(UnsupportedAssetError);
    }, 10_000);

    it("prepareUnshield with zero balance throws InsufficientBalanceError", async () => {
        const { InsufficientBalanceError } = await import("@kohaku-eth/plugins");
        await expect(
            plugin.prepareUnshield(
                { asset: { __type: "native" }, amount: 1_000_000_000_000_000n },
                "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const,
            ),
        ).rejects.toBeInstanceOf(InsufficientBalanceError);
    }, 10_000);
});

// ---------------------------------------------------------------------------

/**
 * Phase 6 end-to-end unshield test.
 *
 * Full lifecycle: shield ETH via Anvil → wait for backend to credit balance →
 * prepareUnshield → broadcast → verify private balance decreased.
 *
 * Requires the Curvy backend, aggregator, and Anvil running (`pnpm dev`).
 * Uses the standard Anvil pre-funded account to submit the on-chain deposit.
 */

const ANVIL_RPC = "http://localhost:8545";
/** Standard Anvil account 0 — 10 000 ETH, private key is well-known. */
const ANVIL_FUNDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function anvilRpc(method: string, params: unknown[]): Promise<unknown> {
    const res = await fetch(ANVIL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`Anvil RPC error: ${json.error.message}`);
    return json.result;
}

/**
 * Send ETH from the Anvil funder to `to` by impersonating the funder account.
 * Uses `eth_sendTransaction` which Anvil allows without a private key.
 */
async function fundPortal(to: string, value: bigint): Promise<void> {
    await anvilRpc("eth_sendTransaction", [
        {
            from: ANVIL_FUNDER,
            to,
            value: `0x${value.toString(16)}`,
        },
    ]);
}

/**
 * Poll `plugin.balance()` until the native ETH balance is at least `minAmount`,
 * retrying every `intervalMs` up to `timeoutMs`.
 */
async function pollForNativeBalance(
    plugin: CurvyPlugin,
    minAmount: bigint,
    timeoutMs = 30_000,
    intervalMs = 2_000,
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

describe("Phase 6: Unshield end-to-end (requires Anvil + backend)", () => {
    const SHIELD_AMOUNT = 5_000_000_000_000_000n; // 0.005 ETH
    const UNSHIELD_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH
    const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const; // Anvil account 1

    const { signingAddress, curvyId } = freshIdentity();
    const host = makeTestHost();
    let plugin: CurvyPlugin;
    let balanceBeforeUnshield: bigint;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(host, {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });

        // Shield ETH: get portal address, then fund it via Anvil.
        const shieldOp = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });
        const portalAddress = shieldOp.txs[0]!.to;
        await fundPortal(portalAddress, SHIELD_AMOUNT);

        // Wait for the backend to detect the deposit and credit the balance.
        balanceBeforeUnshield = await pollForNativeBalance(plugin, UNSHIELD_AMOUNT, 90_000);
    }, 120_000);

    it("prepareUnshield returns a CurvyPrivateOperation with an EstimatedPlan", async () => {
        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: UNSHIELD_AMOUNT },
            RECIPIENT,
        );

        expect(op.__type).toBe("privateOperation");
        expect(op.estimatedPlan).toBeDefined();
    }, 15_000);

    it("broadcast(unshieldOp) executes and private balance decreases", async () => {
        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: UNSHIELD_AMOUNT },
            RECIPIENT,
        );

        await plugin.broadcast(op);

        const balancesAfter = await plugin.balance([{ __type: "native" }]);
        const totalAfter = balancesAfter.reduce((sum, b) => sum + b.amount, 0n);
        expect(totalAfter).toBeLessThan(balanceBeforeUnshield);
    }, 120_000);
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * Phase 4 end-to-end shield test.
 *
 * Verifies that after funding the entry portal address returned by `prepareShield`,
 * the backend asynchronously credits the private balance and `balance()` reflects it.
 */
describe("Phase 4: Shield E2E (requires Anvil + backend)", () => {
    const SHIELD_AMOUNT = 2_000_000_000_000_000n; // 0.002 ETH

    const { signingAddress, curvyId } = freshIdentity();
    let plugin: CurvyPlugin;

    beforeAll(async () => {
        plugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(signingAddress),
            curvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });
    }, 30_000);

    it("balance() reflects shielded ETH after backend processing", async () => {
        const shieldOp = await plugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });

        const portalAddress = shieldOp.txs[0]!.to;
        await fundPortal(portalAddress, SHIELD_AMOUNT);

        const finalBalance = await pollForNativeBalance(plugin, SHIELD_AMOUNT, 60_000);
        expect(finalBalance).toBeGreaterThanOrEqual(SHIELD_AMOUNT);
    }, 90_000);
});

// ---------------------------------------------------------------------------

/**
 * Phase 5 end-to-end transfer test.
 *
 * Full lifecycle: shield ETH into sender → wait for backend credit →
 * prepareTransfer → broadcast → verify sender balance decreases and
 * recipient balance increases.
 *
 * Sender uses TEST_S / TEST_V; recipient uses TEST_S2 / TEST_V2 so their
 * Curvy vaults are genuinely separate.
 */
describe("Phase 5: Transfer E2E (requires Anvil + backend)", () => {
    const SHIELD_AMOUNT = 5_000_000_000_000_000n; // 0.005 ETH
    const TRANSFER_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH

    const { signingAddress: senderSigner, curvyId: senderCurvyId } = freshIdentity();
    const { signingAddress: recipientSigner, curvyId: recipientCurvyId } = freshIdentity();

    let senderPlugin: CurvyPlugin;
    let recipientPlugin: CurvyPlugin;
    let balanceBeforeTransfer: bigint;
    let balanceAfterTransfer: bigint;

    beforeAll(async () => {
        // Register sender (keys: TEST_S / TEST_V)
        senderPlugin = await createCurvyPlugin(makeTestHost(), {
            signature: makeSignature(senderSigner),
            curvyId: senderCurvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });

        // Register recipient (keys: TEST_S2 / TEST_V2 — separate vault)
        recipientPlugin = await createCurvyPlugin(makeTestHost2(), {
            signature: makeSignature(recipientSigner),
            curvyId: recipientCurvyId,
            apiBaseUrl: API_BASE_URL,
            environment: ENVIRONMENT,
        });

        // Shield ETH into sender
        const shieldOp = await senderPlugin.prepareShield({
            asset: { __type: "native" },
            amount: SHIELD_AMOUNT,
        });
        await fundPortal(shieldOp.txs[0]!.to, SHIELD_AMOUNT);

        // Wait for backend to credit sender's private balance
        balanceBeforeTransfer = await pollForNativeBalance(senderPlugin, TRANSFER_AMOUNT, 60_000);

        // Execute the transfer
        const op = await senderPlugin.prepareTransfer(
            { asset: { __type: "native" }, amount: TRANSFER_AMOUNT },
            recipientCurvyId,
        );
        await senderPlugin.broadcast(op);

        const balancesAfter = await senderPlugin.balance([{ __type: "native" }]);
        balanceAfterTransfer = balancesAfter.reduce((sum, b) => sum + b.amount, 0n);
    }, 180_000);

    it("sender balance decreases after transfer", () => {
        expect(balanceAfterTransfer).toBeLessThan(balanceBeforeTransfer);
    });

    it("recipient private balance increases after transfer", async () => {
        // Poll briefly — the backend processes the transfer nearly immediately after broadcast
        const deadline = Date.now() + 15_000;
        let recipientTotal = 0n;
        while (Date.now() < deadline) {
            const balances = await recipientPlugin.balance([{ __type: "native" }]);
            recipientTotal = balances.reduce((sum, b) => sum + b.amount, 0n);
            if (recipientTotal > 0n) break;
            await new Promise((r) => setTimeout(r, 2_000));
        }
        expect(recipientTotal).toBeGreaterThan(0n);
    }, 30_000);
});

// ---------------------------------------------------------------------------

describe("Phase 7: Error mapping", () => {
    describe("Chain validation", () => {
        it("throws UnsupportedChainError when host chain is not supported by Curvy", async () => {
            const { signingAddress, curvyId } = freshIdentity();
            await expect(
                createCurvyPlugin(makeWrongChainHost(), {
                    signature: makeSignature(signingAddress),
                    curvyId,
                    apiBaseUrl: API_BASE_URL,
                    environment: ENVIRONMENT,
                }),
            ).rejects.toBeInstanceOf(UnsupportedChainError);
        }, 30_000);

        it("UnsupportedChainError carries the rejected chain ID", async () => {
            const { signingAddress, curvyId } = freshIdentity();
            let caught: unknown;
            try {
                await createCurvyPlugin(makeWrongChainHost(), {
                    signature: makeSignature(signingAddress),
                    curvyId,
                    apiBaseUrl: API_BASE_URL,
                    environment: ENVIRONMENT,
                });
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(UnsupportedChainError);
            expect((caught as UnsupportedChainError).chainId).toBe(9999n);
        }, 30_000);
    });

    describe("Auth error wrapping", () => {
        it("login with unregistered address produces a descriptive Error, not a raw SDK error", async () => {
            // Fresh identity that was never registered.
            const { signingAddress } = freshIdentity();
            let caught: unknown;
            try {
                await createCurvyPlugin(makeTestHost(), {
                    signature: makeSignature(signingAddress),
                    // No curvyId → login path
                    apiBaseUrl: API_BASE_URL,
                    environment: ENVIRONMENT,
                });
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(Error);
            // Must NOT be a raw SDK CurvyError (APIError / StorageError etc.)
            expect((caught as Error).constructor.name).not.toMatch(/APIError|StorageError|AnnouncementSyncError|CurvyError/);
            // Message must be descriptive
            expect((caught as Error).message).toMatch(/\[Curvy\]/);
        }, 30_000);

        it("registration with a taken handle produces a descriptive Error", async () => {
            // Register a handle first, then try to register it again.
            const { signingAddress, curvyId } = freshIdentity();
            await createCurvyPlugin(makeTestHost(), {
                signature: makeSignature(signingAddress),
                curvyId,
                apiBaseUrl: API_BASE_URL,
                environment: ENVIRONMENT,
            });

            // Second registration with the same handle should fail descriptively.
            const { signingAddress: s2 } = freshIdentity();
            let caught: unknown;
            try {
                await createCurvyPlugin(makeTestHost(), {
                    signature: makeSignature(s2),
                    curvyId, // same handle
                    apiBaseUrl: API_BASE_URL,
                    environment: ENVIRONMENT,
                });
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(Error);
            expect((caught as Error).constructor.name).not.toMatch(/APIError|StorageError|AnnouncementSyncError|CurvyError/);
            expect((caught as Error).message).toMatch(/\[Curvy\]/);
        }, 60_000);
    });
});
