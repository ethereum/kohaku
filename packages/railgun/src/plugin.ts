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
import { JsBroadcaster, JsBroadcasterManager, JsPoiBalance, JsPoiProvedTx, JsPoiProvider, JsPoiTransactionBuilder, JsSigner, JsSyncer, JsTransactionBuilder, RailgunAddress, AssetId as RailgunAssetId } from "./pkg/railgun_rs";
import { createBroadcaster } from "./waku-adapter";
import { GrothProverAdapter, RemoteArtifactLoader } from "./prover-adapter";
import { EthereumProviderAdapter } from "./ethereum-provider";
import { TxData } from "@kohaku-eth/provider";
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";

/**
 * A proved private transaction ready for relay.
 * Consumed on `broadcast()` — rebuild via `prepare*` if retrying.
 */
export type RGPrivateOperation = PrivateOperation & {
    operation: JsPoiProvedTx,
    broadcaster: JsBroadcaster,
    feeToken: `0x${string}`,
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

interface RailgunPluginState {
    providerState: Uint8Array,
    internalSigners: {
        spendingKey: `0x${string}`,
        viewingKey: `0x${string}`,
    }[],
    chainId: bigint,
    version: '0.1.0',
}

const LIST_KEY = "efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88";

/**
 * Creates or loads a Railgun plugin instance. If persisted state exists, it will
 * loaded; otherwise, new keys will be generated and a new provider initialized.
 * 
 * @param host Host struct
 * @returns `RailgunPlugin` instance
 */
export async function createRailgunProvider(host: Host, spendingKey: `0x${string}`, viewingKey: `0x${string}`): Promise<RailgunPlugin> {
    try {
        return await loadRailgunProvider(host);
    } catch (e) {
        console.log("Failed to load existing Railgun provider, creating new one", e);
    }

    const chainId = await host.provider.getChainId();
    const provider = await newRailgunProvider(host, chainId);
    const signer = new JsSigner(spendingKey, viewingKey, chainId);
    const broadcastManager = await createBroadcaster(chainId);

    return new RailgunPlugin(chainId, provider, signer, broadcastManager, host.storage);
}

async function loadRailgunProvider(host: Host): Promise<RailgunPlugin> {
    const savedState = host.storage.get(LIST_KEY);
    if (!savedState) {
        throw new Error("No saved state found for Railgun plugin");
    }

    const { providerState, internalSigners, chainId }: RailgunPluginState = JSON.parse(savedState);
    const remoteChainId = await host.provider.getChainId();
    if (remoteChainId !== chainId) {
        throw new Error(`Unexpected chain ID: remote: ${remoteChainId}, expected: ${chainId}`);
    }

    const provider = await newRailgunProvider(host, chainId);
    provider.setState(providerState);

    const broadcastManager = await createBroadcaster(chainId);

    const plugin = new RailgunPlugin(chainId, provider, null as any, broadcastManager, host.storage);
    for (const signer of internalSigners) {
        plugin.addInternalSigner(signer.spendingKey, signer.viewingKey);
    }

    return plugin;
}

export class RailgunPlugin implements RGInstance, RGBroadcaster {
    /**
     * InternalSigners are preferentially used to fund transact operations.
     */
    private internalSigners: JsSigner[] = [];

    constructor(
        private chainId: bigint,
        private provider: JsPoiProvider,
        private signer: JsSigner,
        private broadcasterManager: JsBroadcasterManager,
        private storage: Storage
    ) {
        this.provider.register(signer);
    }

    async addInternalSigner(spendingKey: `0x${string}`, viewingKey: `0x${string}`) {
        const signer = new JsSigner(spendingKey, viewingKey, this.chainId);
        this.internalSigners.push(signer);
        this.provider.register(signer);
        await this.saveState();
    }

    async instanceId(): Promise<RailgunAddress> {
        return this.signer.address;
    }

    // TODO: Once tags are implemented, enable return poiStatus for each item
    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        await this.provider.sync();
        await this.saveState();
        const balances = await this.signerBalances();

        const all: Map<string, AssetAmount> = new Map();
        for (const [_, balance] of balances) {
            for (const b of balance) {
                if (b.assetId.type !== "Erc20") { continue; }
                if (assets !== undefined && !assets.some((a) => a.__type === 'erc20' && a.contract === b.assetId.value)) { continue; }

                const key = b.assetId.value;
                const existing = all.get(key);
                if (existing) {
                    existing.amount += b.balance;
                    continue;
                }

                all.set(key, {
                    asset: {
                        __type: 'erc20',
                        contract: b.assetId.value,
                    },
                    amount: b.balance,
                });
            }
        }

        return Array.from(all.values());
    }

    async prepareShield(token: AssetAmount): Promise<TxData> {
        tokenGuard(token);

        const txData = this.provider
            .shield()
            .shield(this.signer.address, { type: "Erc20", value: token.asset.contract }, token.amount)
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
            builder = builder.shield(this.signer.address, { type: "Erc20", value: token.asset.contract }, token.amount);
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
        const builder = await this.buildMultiSigner([token], (builder, signer, asset, amount) =>
            builder.unshield(signer, to, asset, amount)
        );
        return this.buildWithBroadcaster(builder);
    }

    async prepareUnshieldMulti(tokens: AssetAmount[], to: `0x${string}`): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        const builder = await this.buildMultiSigner(tokens, (builder, signer, asset, amount) =>
            builder.unshield(signer, to, asset, amount)
        );
        return this.buildWithBroadcaster(builder);
    }

    async prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        tokenGuard(token);
        const builder = await this.buildMultiSigner([token], (builder, signer, asset, amount) =>
            builder.transfer(signer, to, asset, amount, "")
        );
        return this.buildWithBroadcaster(builder);

    }

    async prepareTransferMulti(tokens: AssetAmount[], to: RailgunAddress): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        const builder = await this.buildMultiSigner(tokens, (builder, signer, asset, amount) =>
            builder.transfer(signer, to, asset, amount, "")
        );
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
        await this.provider.broadcast(broadcaster, op.operation);
    }

    /**
     * Builds a private operation by iterating through the user's signers and
     * draining the required tokens.
     * 
     * @param tokens The token amounts required for the operation.
     * @param addToBuilder Callback that adds the required action to the builder for a given signer, token, and amount.
     * @returns A transaction builder with the required actions added for the selected signers and tokens.
     */
    private async buildMultiSigner(
        tokens: AssetAmount[],
        addToBuilder: (builder: JsPoiTransactionBuilder, signer: JsSigner, asset: RailgunAssetId, amount: bigint) => JsPoiTransactionBuilder,
    ): Promise<JsPoiTransactionBuilder> {
        let builder = this.provider.transact();
        const remaining = new Map(tokens.map(t => [t.asset.contract, t.amount]));

        const balances = await this.signerBalances();
        for (const [signer, balance] of balances) {
            for (const b of balance) {
                if (b.assetId.type !== "Erc20") continue;
                const need = remaining.get(b.assetId.value as `0x${string}`);
                if (!need || need <= 0n) continue;

                const take = need < b.balance ? need : b.balance;
                builder = addToBuilder(builder, signer, b.assetId, take);
                remaining.set(b.assetId.value as `0x${string}`, need - take);
            }
        }

        // check remaining are all 0
        for (const [asset, amt] of remaining) {
            if (amt > 0n) throw new Error(`Insufficient balance for ${asset}`);
        }

        return builder;
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
        const balance = await this.provider.balance(this.signer.address, LIST_KEY);

        for (const b of balance) {
            if (b.poiStatus !== "Valid") { continue; }
            if (b.assetId.type !== "Erc20") { continue; }
            if (b.balance <= 0n) { continue; }

            const broadcaster = await this.broadcasterManager.bestBroadcasterForToken(b.assetId.value, BigInt(Date.now()));
            if (!broadcaster) { continue; }

            try {
                const tx = await this.provider.buildBroadcast(builder, this.signer, broadcaster.fee);
                return {
                    __type: 'privateOperation',
                    operation: tx,
                    broadcaster,
                    feeToken: broadcaster.fee.token,
                };
            } catch (e) {
                console.log("Failed to build with broadcaster, trying next one", e);
                continue;
            }
        }

        throw new Error("Failed to build transaction with any broadcaster");
    }

    private async saveState() {
        const providerState = this.provider.state();
        const internalSigners = this.internalSigners.map((s) => ({
            spendingKey: s.spendingKey,
            viewingKey: s.viewingKey,
        }));

        const state: RailgunPluginState = {
            providerState,
            internalSigners,
            chainId: this.chainId,
            version: '0.1.0',
        };

        this.storage.set(LIST_KEY, JSON.stringify(state));
    }

    private async signerBalances(): Promise<[JsSigner, JsPoiBalance[]][]> {
        const signers = [this.signer, ...this.internalSigners];
        return Promise.all(signers.map(async s => [s, await this.validBalance(s)]));
    }

    private async validBalance(signer: JsSigner): Promise<JsPoiBalance[]> {
        const balance = await this.provider.balance(signer.address, LIST_KEY);
        return balance.filter((b) => b.poiStatus === "Valid" && b.balance > 0n);
    }
};

async function newRailgunProvider(host: Host, chain_id: bigint): Promise<JsPoiProvider> {
    const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";
    const rpcAdapter = new EthereumProviderAdapter(host.provider);
    const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
    const syncer = JsSyncer.newChained([
        JsSyncer.newSubsquid(chain_id),
        //? Since all the broadcasters & POI nodes rely on subsquid, there's no 
        //? actual sense in us syncing past subsquid.  So no need to have a RPC
        //? syncer that goes ahead
    ]);

    return await JsPoiProvider.new(rpcAdapter, syncer, prover);
}

function tokenGuard(token: AssetAmount) {
    const asset = token.asset;
    if (asset.__type !== 'erc20') {
        throw new Error("Only ERC20 tokens are supported for shielding");
    }
}
