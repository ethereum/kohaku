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

import type { AssetAmount, AssetId, ERC20AssetId, Host, PluginInstance, PrivateOperation, Storage } from "@kohaku-eth/plugins";
import type { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import type { TxData } from "@kohaku-eth/provider";
import { SignerPool } from "./signer-pool";
import { Bundler, chainConfig, RailgunBuilder, RailgunProvider, RailgunSigner, ShieldBuilder, Signer, TransactionBuilder, type ChainConfig, type RailgunAddress, type SignableUserOperation } from "../pkg";
import { DatabaseAdapter, ensureInitialized, EthereumProviderAdapter } from "./lib";

/**
 * A proved private transaction ready for relay.
 */
export type RGPrivateOperation = PrivateOperation & {
    builder: TransactionBuilder,
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


export type RailgunPluginConfig = {
    /** Optional index for key derivation (default: 0) */
    keyIndex?: number,
    /** Optional POI toggle */
    poi?: boolean,
    /** Optional bundler config */
    bundler?: BundlerConfig
};

export type BundlerConfig = {
    /** 4337 bundler */
    bundler?: Bundler,
    /** 7702 delegating account */
    delegating_account?: Signer,
}
/**
 * Creates or loads a Railgun plugin instance.
 * 
 * @param host Host struct
 * @param keyIndex Optional index for key derivation (default: 0)
 * @returns `RailgunPlugin` instance
 */
export async function createRailgunPlugin(host: Host, config?: RailgunPluginConfig): Promise<RailgunPlugin> {
    await ensureInitialized();

    const keyIndex = config?.keyIndex ?? 0;
    const spendingKey = host.keystore.deriveAt(RailgunSigner.spendingKeyPath(keyIndex));
    const viewingKey = host.keystore.deriveAt(RailgunSigner.viewingKeyPath(keyIndex));

    const chainId = await host.provider.getChainId();
    const chain = chainConfig(chainId);
    if (!chain) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const eip1193Provider = new EthereumProviderAdapter(host.provider);
    const database = new DatabaseAdapter(host.storage);
    const builder = new RailgunBuilder(chain, eip1193Provider).withDatabase(database);
    if (config?.poi) {
        builder.withPoi();
    }
    const provider = await builder.build();

    const signer = RailgunSigner.privateKey(spendingKey, viewingKey, chainId);

    provider.register(signer);
    const pool = new SignerPool(signer);

    const plugin = new RailgunPlugin(chain, provider, pool);
    plugin.setBundler(config?.bundler?.bundler);
    plugin.setDelegatingSigner(config?.bundler?.delegating_account);

    return plugin;
}

export class RailgunPlugin implements RGInstance, RGBroadcaster {
    private bundler: Bundler | undefined;
    private delegatingSigner: Signer | undefined;

    constructor(
        private chain: ChainConfig,
        private provider: RailgunProvider,
        private pool: SignerPool,
    ) { }

    setBundler(bundler?: Bundler) {
        this.bundler = bundler;
    }

    setDelegatingSigner(signer?: Signer) {
        this.delegatingSigner = signer;
    }

    async addInternalSigner(spendingKey: `0x${string}`, viewingKey: `0x${string}`) {
        const signer = RailgunSigner.privateKey(spendingKey, viewingKey, BigInt(this.chain.id));

        this.pool.add(signer);
        this.provider.register(signer);
    }

    async instanceId(): Promise<RailgunAddress> {
        return this.pool.primary.address;
    }

    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        await this.provider.sync();

        const all: Map<string, AssetAmount> = new Map();

        for (const signer of this.pool.all) {
            const balances = await this.provider.balance(signer.address);
            for (const b of balances) {
                const assetId = b[0];
                const balance = b[1];

                if (assetId.type !== "Erc20") continue;
                if (balance <= 0n) continue;

                if (assets && !assets.some(a => a.__type === 'erc20' && a.contract === assetId.value)) continue;

                const key = assetId.value;
                const existing = all.get(key);

                if (existing) { existing.amount += balance; }
                else { all.set(key, { asset: { __type: 'erc20', contract: key }, amount: balance }); }
            }
        }

        return Array.from(all.values());
    }

    async prepareShield(asset: AssetAmount): Promise<TxData[]> {
        let builder = this.provider.shield();
        builder = this.addShield(asset.asset, asset.amount, builder);

        const txData = builder.build();
        return txData.map((tx) => ({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        }));
    }

    async prepareShieldMulti(tokens: AssetAmount[]): Promise<TxData[]> {
        let builder = this.provider.shield();

        for (const token of tokens) {
            this.addShield(token.asset, token.amount, builder);
        }

        const txData = builder.build();

        return txData.map((tx) => ({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        }));
    }

    private addShield(asset: AssetId | { __type: 'native' }, amount: bigint, builder: ShieldBuilder) {
        if (asset.__type === 'erc20') {
            builder = builder.shield(this.pool.primary.address, { type: "Erc20", value: asset.contract }, amount);
        } else if (asset.__type === 'native') {
            builder = builder.shieldNative(this.pool.primary.address, amount);
        } else {
            throw new Error("Unsupported asset type for shielding");
        }
        return builder;
    }

    async prepareUnshield(token: AssetAmount, to: `0x${string}`): Promise<RGPrivateOperation> {
        tokenGuard(token);

        //? Safe because of above tokenGuard
        const entries = await this.pool.drain(this.provider, [token as AssetAmount<ERC20AssetId>]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.unshield(e.signer, to, e.asset, e.amount);
        }

        return { __type: 'privateOperation', builder };
    }

    async prepareUnshieldMulti(tokens: AssetAmount[], to: `0x${string}`): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        //? Safe because of above tokenGuard
        const entries = await this.pool.drain(this.provider, tokens as AssetAmount<ERC20AssetId>[]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.unshield(e.signer, to, e.asset, e.amount);
        }

        return { __type: 'privateOperation', builder };
    }

    async prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        tokenGuard(token);

        //? Safe because of above tokenGuard
        const entries = await this.pool.drain(this.provider, [token as AssetAmount<ERC20AssetId>]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.transfer(e.signer, to, e.asset, e.amount, "");
        }

        return { __type: 'privateOperation', builder };
    }

    async prepareTransferMulti(tokens: AssetAmount[], to: RailgunAddress): Promise<RGPrivateOperation> {
        for (const token of tokens) {
            tokenGuard(token);
        }

        //? Safe because of above tokenGuard
        const entries = await this.pool.drain(this.provider, tokens as AssetAmount<ERC20AssetId>[]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.transfer(e.signer, to, e.asset, e.amount, "");
        }

        return { __type: 'privateOperation', builder };
    }

    /**
     * Broadcast a private operation to the network.
     */
    async broadcast(op: RGPrivateOperation): Promise<void> {
        if (!this.bundler) throw new Error("No bundler configured for broadcast");
        if (!this.delegatingSigner) throw new Error("No delegating signer configured for broadcast");

        const signableUserOp = await this.provider.prepareUserOp(
            op.builder,
            this.bundler,
            this.delegatingSigner.address,
            this.pool.primary,
            this.chain.wrappedBaseToken,
        );

        const signedUserOp = await signableUserOp.sign(this.delegatingSigner);
        const userOpHash = await this.bundler.sendUserOperation(signedUserOp);

        console.log(`Broadcasted user operation with hash: ${userOpHash}`);

        const receipt = await this.bundler.waitForReceipt(userOpHash);
        console.log(`User operation included: ${receipt}`);
    }
};

function tokenGuard(token: AssetAmount) {
    const asset = token.asset;

    if (asset.__type !== 'erc20') {
        throw new Error("Only ERC20 tokens are supported for shielding");
    }
}
