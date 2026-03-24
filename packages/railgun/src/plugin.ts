/**
 * @module railgun-plugin
 *
 * Railgun privacy provider for Kohaku. Wraps railgun-rs WASM bindings into the
 * Kohaku plugin interface.
 *
 * ## Pipeline
 *
 * 1. **Create**: `createRailgunProvider(host, spendingKey, viewingKey)`
 *    Loads persisted state if available, otherwise initializes fresh.
 *    Returns a `RailgunPlugin` that implements both `RGInstance` and 
 *    `RGBroadcaster`.
 *
 * 2. **Sync**: Happens implicitly on `balance()`. The provider pulls new
 *    commitments from Subsquid and updates local UTXO state.
 *
 * 3. **Prepare**:
 *    - Shield returns raw `TxData` (user signs & sends directly).
 *    - Transfer/Unshield return `RGPrivateOperation` — a proved tx bundled
 *      with a selected broadcaster, ready for relay.
 *
 * 4. **Broadcast**: relays the proved tx through the selected Waku broadcaster. 
 *    The operation is consumed; rebuild on failure.
 *
 * ## Internal Signers
 *
 * A plugin instance has one primary signer (set at creation) plus optional
 * internal signers added via `addInternalSigner`. When building private ops,
 * `buildMultiSigner` drains UTXOs across all signers to satisfy the requested
 * amounts — primary first, then internal signers in insertion order.
 *
 * This matters for recovery/consolidation flows where funds are spread across
 * multiple Railgun keypairs.
 *
 * ## State Persistence
 *
 * Provider state + internal signer keys are serialized to `host.storage`
 * after every sync and signer addition. On reload, `createRailgunProvider`
 * restores from storage automatically.
 */

import { AssetAmount, AssetId, Host, PluginInstance, PrivateOperation, Storage } from "@kohaku-eth/plugins";
import { derivationPaths, JsBroadcaster, JsBroadcasterManager, JsPoiProvedTx, JsPoiProvider, JsSigner, JsTransactionBuilder, RailgunAddress } from "./pkg/railgun_rs";
import { createBroadcaster } from "./waku-adapter";
import { TxData } from "@kohaku-eth/provider";
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { loadRailgunProvider, newRailgunProvider } from "./railgun-provider";
import { RailgunPluginState, STATE_KEY } from "./state";
import { SignerPool } from "./signer-pool";

/**
 * A proved private transaction ready for relay.
 * Consumed on `broadcast()` — rebuild via `prepare*` if retrying.
 */
export type RGPrivateOperation = PrivateOperation & {
    provedTx: JsPoiProvedTx,
    broadcaster: JsBroadcaster,
};

/**
 * Full plugin interface: prepare private operations + query balances.
 */
export type RGInstance = PluginInstance<
    RailgunAddress,
    {
        privateOp: RGPrivateOperation,
        features: {
            prepareShield: true,
            prepareShieldMulti: true,
            prepareTransfer: true,
            prepareTransferMulti: true,
            prepareUnshield: true,
            prepareUnshieldMulti: true,
        },
    }
>;

/**
 * Broadcast interface: relay proved transactions via Waku.
 */
export type RGBroadcaster = Broadcaster<RGPrivateOperation>;

const LIST_KEY = "efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88";

/**
 * Creates or loads a Railgun plugin instance. If persisted state exists, it will
 * loaded; otherwise, new keys will be generated and a new provider initialized.
 * 
 * @param host Host struct
 * @returns `RailgunPlugin` instance
 */
export async function createRailgunPlugin(host: Host): Promise<RailgunPlugin> {
    try {
        return await loadRailgunProvider(host);
    } catch (e) {
        console.log("Failed to load existing Railgun provider, creating new one", e);
    }

    const { spendingPath, viewingPath } = derivationPaths(0);
    const spendingKey = host.keystore.deriveAt(spendingPath);
    const viewingKey = host.keystore.deriveAt(viewingPath);

    const chainId = await host.provider.getChainId();
    const provider = await newRailgunProvider(host, chainId);
    const signer = new JsSigner(spendingKey, viewingKey, chainId);
    const pool = new SignerPool(signer);
    const broadcastManager = await createBroadcaster(chainId);

    return new RailgunPlugin(chainId, provider, pool, broadcastManager, host.storage);
}

export class RailgunPlugin implements RGInstance, RGBroadcaster {
    constructor(
        private chainId: bigint,
        private provider: JsPoiProvider,
        private pool: SignerPool,
        private broadcasterManager: JsBroadcasterManager,
        private storage: Storage
    ) {
        this.pool.registerAll(provider)
    }

    async addInternalSigner(spendingKey: `0x${string}`, viewingKey: `0x${string}`) {
        const signer = new JsSigner(spendingKey, viewingKey, this.chainId);

        this.pool.add(signer);
        await this.saveState();
    }

    async instanceId(): Promise<RailgunAddress> {
        return this.pool.primary.address;
    }

    // TODO: Once tags are implemented, enable return poiStatus for each item
    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        await this.provider.sync();
        await this.saveState();

        const all: Map<string, AssetAmount> = new Map();

        for (const signer of this.pool.all) {
            const balance = await this.provider.balance(signer.address, LIST_KEY);

            for (const b of balance) {
                if (b.assetId.type !== "Erc20") continue;

                if (b.poiStatus !== "Valid" || b.balance <= 0n) continue;

                if (assets && !assets.some(a => a.__type === 'erc20' && a.contract === b.assetId.value)) continue;

                const key = b.assetId.value;
                const existing = all.get(key);

                if (existing) { existing.amount += b.balance; }
                else { all.set(key, { asset: { __type: 'erc20', contract: key }, amount: b.balance }); }
            }
        }

        return Array.from(all.values());
    }

    async prepareShield(token: AssetAmount): Promise<TxData> {
        tokenGuard(token);

        const txData = this.provider
            .shield()
            .shield(this.pool.primary.address, { type: "Erc20", value: token.asset.contract }, token.amount)
            .build();

        return {
            to: txData.to,
            data: txData.data,
            value: BigInt(txData.value)
        };
    }

    async prepareShieldMulti(tokens: AssetAmount[]): Promise<TxData> {
        let builder = this.provider.shield();

        for (const token of tokens) {
            tokenGuard(token);
            builder = builder.shield(this.pool.primary.address, { type: "Erc20", value: token.asset.contract }, token.amount);
        }

        const txData = builder.build();

        return {
            to: txData.to,
            data: txData.data,
            value: BigInt(txData.value)
        };
    }

    async prepareUnshield(token: AssetAmount, to: `0x${string}`): Promise<RGPrivateOperation> {
        tokenGuard(token);
        const entries = await this.pool.drain(this.provider, LIST_KEY, [token]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.unshield(e.signer, to, e.asset, e.amount);
        }

        return this.buildWithBroadcaster(builder);

    }

    async prepareUnshieldMulti(tokens: AssetAmount[], to: `0x${string}`): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        const entries = await this.pool.drain(this.provider, LIST_KEY, tokens);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.unshield(e.signer, to, e.asset, e.amount);
        }

        return this.buildWithBroadcaster(builder);
    }

    async prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        tokenGuard(token);

        const entries = await this.pool.drain(this.provider, LIST_KEY, [token]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.transfer(e.signer, to, e.asset, e.amount, "");
        }

        return this.buildWithBroadcaster(builder);

    }

    async prepareTransferMulti(tokens: AssetAmount[], to: RailgunAddress): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        const entries = await this.pool.drain(this.provider, LIST_KEY, tokens);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.transfer(e.signer, to, e.asset, e.amount, "");
        }

        return this.buildWithBroadcaster(builder);
    }

    /**
     * Broadcast a private operation to the network. The operation is consumed 
     * by this call, so any re-attempts must be made by re-building the operation 
     * with the prepare* methods.
     * 
     * TODO: The above is unintuitive. It's a requirement because the broadcaster 
     * is selected at build time so, if the issue is with the broadcaster, we need 
     * to re-build to select a new one.  It might be better to select the broadcaster 
     * at broadcast time, but that means we won't be able to expose any fee info
     * in the privateOperation object. 
     */
    async broadcast(op: RGPrivateOperation): Promise<void> {
        const broadcaster = op.broadcaster;

        await this.provider.broadcast(broadcaster, op.provedTx);
    }

    /**
     * Builds a private operation by selecting the first valid broadcaster from the 
     * user's balance. 
     * 
     * TODO: Implement a more robust selection strategory, allowing users to designate
     * preferred broadcasters, preferred fee assets, etc.
     */
    private async buildWithBroadcaster(
        builder: JsTransactionBuilder,
    ): Promise<RGPrivateOperation> {
        const balance = await this.provider.balance(this.pool.primary.address, LIST_KEY);

        for (const b of balance) {
            if (b.poiStatus !== "Valid") { continue; }

            if (b.assetId.type !== "Erc20") { continue; }

            if (b.balance <= 0n) { continue; }

            const broadcaster = await this.broadcasterManager.bestBroadcasterForToken(b.assetId.value, BigInt(Date.now()));

            if (!broadcaster) { continue; }

            try {
                const tx = await this.provider.buildBroadcast(builder, this.pool.primary, broadcaster.fee);

                return {
                    __type: 'privateOperation',
                    provedTx: tx,
                    broadcaster,
                };
            } catch (e) {
                console.log("Failed to build with broadcaster, trying next one", e);
                continue;
            }
        }

        throw new Error("Failed to build transaction with any broadcaster");
    }

    private async saveState() {
        const state: RailgunPluginState = {
            providerState: this.provider.state(),
            internalSigners: this.pool.internalKeys(),
            chainId: this.chainId,
            version: '0.1.0',
        };

        this.storage.set(STATE_KEY, JSON.stringify(state));
    }
};


function tokenGuard(token: AssetAmount) {
    const asset = token.asset;

    if (asset.__type !== 'erc20') {
        throw new Error("Only ERC20 tokens are supported for shielding");
    }
}
