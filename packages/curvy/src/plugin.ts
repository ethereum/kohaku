import * as AbiFunction from "ox/AbiFunction";
import type { Address } from "ox/Address";
import type { Host, AssetAmount, AssetId, PrivateOperation, PublicOperation, PluginInstance } from "@kohaku-eth/plugins";
import { UnsupportedAssetError, InsufficientBalanceError, InvalidAddressError, UnsupportedChainError } from "@kohaku-eth/plugins";
import { CurvySDK, NATIVE_CURRENCY_ADDRESS, isValidCurvyId, isValidAddressFormat } from "@0xcurvy/curvy-sdk";
import { APIError, AnnouncementSyncError, StorageError } from "@0xcurvy/curvy-sdk";
import type { CurvyId, EvmSignatureData, EstimatedPlan, BalanceEntry, Currency, Network } from "@0xcurvy/curvy-sdk";
import { HostStorageAdapter } from "./storage-adapter";

/**
 * BIP-44 coin type for Curvy key derivation.
 *
 * TODO(open-question-1): This is a placeholder. A registered SLIP-0044 coin type
 * should be agreed upon. Railgun uses 1984'; using 1985' here until resolved.
 */
const CURVY_COIN_TYPE = 1985;

function derivationPaths(keyIndex: number) {
    return {
        spendingPath: `m/44'/${CURVY_COIN_TYPE}'/0'/0'/${keyIndex}`,
        viewingPath: `m/44'/${CURVY_COIN_TYPE}'/0'/1'/${keyIndex}`,
    };
}

/**
 * Maps raw SDK errors to Kohaku plugin errors or descriptive plain Errors.
 * No CurvyError / APIError / StorageError / AnnouncementSyncError should
 * leak through the plugin interface after passing through this function.
 *
 * @param err   The caught error (unknown type).
 * @param ctx   Short description of the operation for error messages.
 */
function wrapSdkError(err: unknown, ctx: string): never {
    const msg = err instanceof Error ? err.message : String(err);

    // --- APIError: map by status code and message -------------------------
    if (err instanceof APIError) {
        if (err.statusCode === 404 || /not found/i.test(msg)) {
            throw new InvalidAddressError(msg);
        }
        if (err.statusCode === 409) {
            throw new Error(`[Curvy] ${ctx}: handle already registered — ${msg}`);
        }
        throw new Error(
            `[Curvy] ${ctx}: API request failed (HTTP ${err.statusCode ?? "unknown"}): ${msg}`,
        );
    }

    // --- AnnouncementSyncError --------------------------------------------
    if (err instanceof AnnouncementSyncError) {
        throw new Error(`[Curvy] ${ctx}: balance sync failed — ${msg}`);
    }

    // --- StorageError -----------------------------------------------------
    if (err instanceof StorageError) {
        throw new Error(`[Curvy] ${ctx}: storage error — ${msg}`);
    }

    // --- Generic Errors with recognisable messages -----------------------

    // Auth: address has no registered Curvy account
    if (/no curvy handle found for address/i.test(msg)) {
        throw new Error(
            `[Curvy] ${ctx}: no Curvy account found for this signing address. ` +
            `Register first by passing a curvyId to createCurvyPlugin.`,
        );
    }

    // Auth: wrong private keys for the registered handle
    if (/wrong password for handle/i.test(msg)) {
        throw new Error(`[Curvy] ${ctx}: key mismatch — the derived keys do not match the registered account.`);
    }

    // Auth: handle already taken during registration
    if (/already registered/i.test(msg)) {
        throw new Error(`[Curvy] ${ctx}: handle already registered — ${msg}`);
    }

    // Auth: registration validation failure
    if (/registration validation failed/i.test(msg)) {
        throw new Error(`[Curvy] ${ctx}: registration failed — ${msg}`);
    }

    // Recipient not found (transfer/unshield)
    if (/handle .+ does not exist/i.test(msg) || /not found/i.test(msg)) {
        throw new InvalidAddressError(msg);
    }

    // Planner: network doesn't support aggregation (wrong chain configuration)
    if (/does not support aggregation/i.test(msg)) {
        throw new Error(`[Curvy] ${ctx}: network does not support Curvy operations — check chain configuration.`);
    }

    // Planner: insufficient balance (shouldn't normally surface — we check ahead of time)
    if (/insufficient balance/i.test(msg)) {
        throw new Error(`[Curvy] ${ctx}: ${msg}`);
    }

    // --- Fallback: wrap with context so raw SDK errors never propagate ----
    throw new Error(`[Curvy] ${ctx}: ${msg}`);
}

/**
 * A prepared private transfer or unshield, ready to be executed via `broadcast()`.
 * Carries the SDK's `EstimatedPlan` through the prepare → broadcast split.
 * Consumed on broadcast — retries require a new `prepare*` call.
 */
export type CurvyPrivateOperation = PrivateOperation & {
    estimatedPlan: EstimatedPlan;
};

/**
 * On-chain transaction data returned by `prepareShield`.
 * For ERC-20: `data` contains the encoded `transfer(portal, amount)` calldata.
 * For native ETH: `data` is `"0x"` and `value` carries the amount.
 */
export type ShieldTx = {
    to: string;
    data: string;
    value: bigint;
};

/**
 * A prepared shield operation. Contains the on-chain transaction(s) the user
 * must sign and broadcast to initiate the deposit. The private balance will
 * not update until the backend asynchronously processes the deposit.
 */
export type CurvyPublicOperation = PublicOperation & {
    txs: ShieldTx[];
};

/**
 * Kohaku plugin instance type for Curvy.
 *
 * Enabled features: shield, transfer, unshield (single-asset each).
 * Multi-asset variants are deferred to a future iteration.
 */
export type CurvyInstance = PluginInstance<
    CurvyId,
    {
        privateOp: CurvyPrivateOperation;
        publicOp: CurvyPublicOperation;
        features: {
            prepareShield: true;
            prepareShieldMulti: false;
            prepareTransfer: true;
            prepareTransferMulti: false;
            prepareUnshield: true;
            prepareUnshieldMulti: false;
        };
    }
>;

export type CurvyPluginParams = {
    /** EVM address that owns this Curvy account (used for login/registration lookup). */
    signature: EvmSignatureData;
    /** If provided, attempts to register a new account with this Curvy ID. Otherwise logs in. */
    curvyId?: CurvyId;
    /** Curvy backend API endpoint. Defaults to the SDK's built-in URL. */
    apiBaseUrl?: string;
    /** Network environment. Defaults to 'testnet'. */
    environment?: "testnet";
    /** Index for BIP-44 key derivation. Defaults to 0. */
    keyIndex?: number;
    /** URL for the Curvy Core WASM module. The SDK's default is used when omitted. */
    wasmUrl?: string;
};

/**
 * Creates a Curvy plugin instance for use with a Kohaku wallet.
 *
 * Derives spending and viewing keys from `host.keystore` at Curvy-specific BIP-44
 * paths, initializes the Curvy SDK, and authenticates — registering if `params.curvyId`
 * is provided, logging in otherwise.
 *
 * NOTE: Storage and network adapters (host.storage, host.network.fetch) are wired
 * in Phase 2. This initial implementation uses the SDK's in-memory defaults.
 */
export async function createCurvyPlugin(host: Host, params: CurvyPluginParams): Promise<CurvyPlugin> {
    const {
        signature,
        curvyId,
        apiBaseUrl,
        environment = "testnet",
        keyIndex = 0,
        wasmUrl,
    } = params;

    const { spendingPath, viewingPath } = derivationPaths(keyIndex);
    const sRaw = host.keystore.deriveAt(spendingPath);
    const vRaw = host.keystore.deriveAt(viewingPath);
    // Strip 0x prefix — Go WASM hex.DecodeString expects raw hex.
    const s = sRaw.startsWith("0x") ? sRaw.slice(2) : sRaw;
    const v = vRaw.startsWith("0x") ? vRaw.slice(2) : vRaw;

    const storage = new HostStorageAdapter(host.storage);
    const customFetch = host.network.fetch.bind(host.network);
    const sdk = await CurvySDK.init(environment, apiBaseUrl, storage, wasmUrl, undefined, false, customFetch);

    // Validate that the host's connected chain is supported by Curvy.
    const hostChainId = await host.provider.getChainId();
    const supportedChainIds = sdk.getNetworks().map((n) => BigInt(n.chainId));
    if (supportedChainIds.length > 0 && !supportedChainIds.includes(hostChainId)) {
        throw new UnsupportedChainError(hostChainId);
    }

    // Authenticate — registration if curvyId provided, otherwise login.
    try {
        if (curvyId !== undefined) {
            await sdk.walletManager.registerWalletWithPrivateKeys(s, v, curvyId, signature.signingAddress);
        } else {
            await sdk.walletManager.addWalletWithPrivateKeys(s, v, signature.signingAddress);
        }
    } catch (err) {
        wrapSdkError(err, curvyId !== undefined ? `register(${curvyId})` : "login");
    }

    return new CurvyPlugin(sdk, hostChainId);
}

function balanceEntryToAssetId(entry: BalanceEntry): AssetId {
    if (entry.currencyAddress.toLowerCase() === NATIVE_CURRENCY_ADDRESS.toLowerCase()) {
        return { __type: "native" };
    }
    return { __type: "erc20", contract: entry.currencyAddress as Address };
}

function aggregateBalances(entries: BalanceEntry[]): AssetAmount[] {
    const map = new Map<string, AssetAmount>();
    for (const entry of entries) {
        const key = entry.currencyAddress.toLowerCase();
        const existing = map.get(key);
        if (existing) {
            existing.amount += entry.balance;
        } else {
            map.set(key, { asset: balanceEntryToAssetId(entry), amount: entry.balance });
        }
    }
    return Array.from(map.values());
}

function assetMatches(filter: AssetId, candidate: AssetId): boolean {
    if (filter.__type !== candidate.__type) return false;
    if (filter.__type === "erc20" && candidate.__type === "erc20") {
        return filter.contract.toLowerCase() === candidate.contract.toLowerCase();
    }
    return filter.__type === "native";
}

export class CurvyPlugin implements CurvyInstance {
    constructor(private readonly sdk: CurvySDK, private readonly hostChainId: bigint) {}

    private findCurrencyAndNetwork(assetId: AssetId): { currency: Currency; network: Network } | undefined {
        for (const network of this.sdk.getNetworks()) {
            // Only match currencies on the host's connected chain.
            if (BigInt(network.chainId) !== this.hostChainId) continue;
            for (const currency of network.currencies) {
                if (assetId.__type === "native" && currency.nativeCurrency) {
                    return { currency, network };
                }
                if (
                    assetId.__type === "erc20" &&
                    currency.contractAddress.toLowerCase() === assetId.contract.toLowerCase()
                ) {
                    return { currency, network };
                }
            }
        }
        return undefined;
    }

    private async getAvailableBalance(assetId: AssetId): Promise<bigint> {
        const entries = await this.sdk.getBalances(true);
        const currencyAddress =
            assetId.__type === "native" ? NATIVE_CURRENCY_ADDRESS : assetId.contract;
        return entries
            .filter((e) => e.currencyAddress.toLowerCase() === currencyAddress.toLowerCase())
            .reduce((sum, e) => sum + e.balance, 0n);
    }

    async instanceId(): Promise<CurvyId> {
        try {
            const handle = this.sdk.walletManager.activeWallet.curvyHandle;
            if (handle === null) {
                throw new Error("No active Curvy wallet. Plugin must be initialized via createCurvyPlugin.");
            }
            return handle;
        } catch (err) {
            if (err instanceof Error && err.message.includes("No active Curvy wallet")) throw err;
            wrapSdkError(err, "instanceId");
        }
    }

    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        let entries: BalanceEntry[];
        try {
            entries = await this.sdk.getBalances(false);
        } catch (err) {
            wrapSdkError(err, "balance");
        }
        const aggregated = aggregateBalances(entries);

        if (assets === undefined) {
            return aggregated;
        }

        return aggregated.filter((a) => assets.some((filter) => assetMatches(filter, a.asset)));
    }

    async prepareShield(asset: AssetAmount): Promise<CurvyPublicOperation> {
        const curvyId = await this.instanceId();

        const found = this.findCurrencyAndNetwork(asset.asset);
        if (found === undefined) {
            throw new UnsupportedAssetError(asset.asset);
        }
        const foundCurrencyId = found.currency.id;

        let portalAddress: string;
        try {
            portalAddress = await this.sdk.generateEntryPortal({
                curvyId,
                currencyId: foundCurrencyId,
                coinType: String(found.network.slip0044),
            });
        } catch (err) {
            wrapSdkError(err, "prepareShield");
        }

        let tx: ShieldTx;

        if (asset.asset.__type === "native") {
            tx = { to: portalAddress, data: "0x", value: asset.amount };
        } else {
            // ERC-20: transfer(address to, uint256 amount)
            const data = AbiFunction.encodeData(
                {
                    type: "function",
                    name: "transfer",
                    inputs: [
                        { name: "to", type: "address" },
                        { name: "amount", type: "uint256" },
                    ],
                    outputs: [{ name: "", type: "bool" }],
                    stateMutability: "nonpayable",
                } as const,
                [portalAddress as `0x${string}`, asset.amount],
            );
            tx = { to: (asset.asset as { contract: string }).contract, data, value: 0n };
        }

        return { __type: "publicOperation", txs: [tx] };
    }

    async prepareTransfer(asset: AssetAmount, to: CurvyId): Promise<CurvyPrivateOperation> {
        if (!isValidCurvyId(to)) {
            throw new InvalidAddressError(to);
        }

        const found = this.findCurrencyAndNetwork(asset.asset);
        if (found === undefined) {
            throw new UnsupportedAssetError(asset.asset);
        }

        const available = await this.getAvailableBalance(asset.asset);
        if (available < asset.amount) {
            throw new InsufficientBalanceError(asset.asset, asset.amount, available);
        }

        try {
            const result = await this.sdk.estimate({
                type: "curvy-transfer",
                amount: asset.amount,
                currency: found.currency,
                network: found.network,
                recipient: to,
            });
            return { __type: "privateOperation", estimatedPlan: result.plan };
        } catch (err) {
            wrapSdkError(err, "prepareTransfer");
        }
    }

    async prepareUnshield(asset: AssetAmount, to: Address): Promise<CurvyPrivateOperation> {
        if (!isValidAddressFormat(to)) {
            throw new InvalidAddressError(to);
        }

        const found = this.findCurrencyAndNetwork(asset.asset);
        if (found === undefined) {
            throw new UnsupportedAssetError(asset.asset);
        }

        const available = await this.getAvailableBalance(asset.asset);
        if (available < asset.amount) {
            throw new InsufficientBalanceError(asset.asset, asset.amount, available);
        }

        try {
            const result = await this.sdk.estimate({
                type: "external-transfer",
                amount: asset.amount,
                currency: found.currency,
                network: found.network,
                recipient: to,
            });
            return { __type: "privateOperation", estimatedPlan: result.plan };
        } catch (err) {
            wrapSdkError(err, "prepareUnshield");
        }
    }

    async broadcast(op: CurvyPrivateOperation): Promise<void> {
        let result: Awaited<ReturnType<typeof this.sdk.execute>>;
        try {
            result = await this.sdk.execute(op.estimatedPlan);
        } catch (err) {
            wrapSdkError(err, "broadcast");
        }
        if (!result.success) {
            // result.error may be a raw SDK error — wrap it
            const err = result.error;
            if (err instanceof Error && !(err instanceof APIError) && !(err instanceof StorageError) && !(err instanceof AnnouncementSyncError)) {
                throw err;
            }
            wrapSdkError(err, "broadcast");
        }
    }
}
