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

import type { AssetAmount, AssetId, ERC20AssetId, Host, PluginInstance, PrivateOperation } from "@kohaku-eth/plugins";
import type { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import type { TxData } from "@kohaku-eth/provider";
import { SignerPool } from "./signer-pool";
import { Bundler, chainConfig, RailgunBuilder, RailgunProvider, RailgunSigner, ShieldBuilder, Signer, SimpleSmartAccount, TransactionBuilder, UtxoSyncer, type Call, type ChainConfig, type RailgunAddress } from "../pkg";
import { ensureInitialized } from "./lib";
import { EthereumProviderAdapter } from "./ethereum-provider";
import { DatabaseAdapter } from "./database";
import { encodeFunctionData } from "viem";

const BPS_DENOMINATOR = 10_000n;

/**
 * A proved private transaction ready for relay.
 */
export type RGPrivateOperation = PrivateOperation & {
    builder: TransactionBuilder,

    // Optional fields for native unshield support
    nativeAmount?: bigint,
    to?: `0x${string}`,
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
    /** Optional RPC call batch size when syncing (default: 10) */
    rpcBatchSize?: number,
    /** Optional index for key derivation (default: 0) */
    keyIndex?: number,
    /** Optional POI toggle (default: true) */
    poi?: boolean,
    /** Optional bundler config */
    bundler?: BundlerConfig
};

export type BundlerConfig = {
    /** 4337 bundler */
    bundler?: Bundler,
    /** 7702 smart account signer */
    smartAccountSigner?: Signer,
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

    console.log("Deriving keys");
    const keyIndex = config?.keyIndex ?? 0;
    const spendingKey = host.keystore.deriveAt(RailgunSigner.spendingKeyPath(keyIndex));
    const viewingKey = host.keystore.deriveAt(RailgunSigner.viewingKeyPath(keyIndex));

    console.log("Fetching chain config");
    const chainId = await host.provider.getChainId();
    const chain = chainConfig(chainId);
    if (!chain) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const eip1193Provider = new EthereumProviderAdapter(host.provider);
    const database = new DatabaseAdapter(chainId.toString(), host.storage);

    console.log("Building Railgun provider");
    let builder = new RailgunBuilder(chain, eip1193Provider)
        .withDatabase(database)
        .withUtxoSyncer(
            UtxoSyncer.chained([
                UtxoSyncer.subsquid(chain),
                UtxoSyncer.rpc(chain, eip1193Provider, BigInt(config?.rpcBatchSize ?? 10))
            ])
        );
    if (config?.poi !== false) {
        console.log("Enabling POI");
        builder = builder.withPoi();
    }

    console.log("Initializing provider");
    const provider = await builder.build();
    const signer = RailgunSigner.privateKey(spendingKey, viewingKey, chainId);

    console.log("Registering signer with provider");
    await provider.register(signer);
    const pool = new SignerPool(signer);

    console.log("Creating plugin instance");
    const plugin = new RailgunPlugin(chain, provider, pool);
    plugin.setBundler(config?.bundler?.bundler);
    if (config?.bundler?.smartAccountSigner) {
        const smartAccount = new SimpleSmartAccount(
            config?.bundler?.smartAccountSigner.address,
            BigInt(chain.id),
            eip1193Provider,
        );
        plugin.setSmartAccount(smartAccount, config?.bundler?.smartAccountSigner);
    }

    return plugin;
}

export class RailgunPlugin implements RGInstance, RGBroadcaster {
    private bundler: Bundler | undefined;
    private smartAccount: SimpleSmartAccount | undefined;
    private smartAccountSigner: Signer | undefined;

    constructor(
        private chain: ChainConfig,
        private provider: RailgunProvider,
        private pool: SignerPool,
    ) { }

    setBundler(bundler?: Bundler) {
        this.bundler = bundler;
    }

    setSmartAccount(smartAccount: SimpleSmartAccount, signer: Signer) {
        this.smartAccount = smartAccount;
        this.smartAccountSigner = signer;
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
        console.log("Syncing provider before balance query");
        await this.provider.sync();

        console.log("Calculating balances across all signers");
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
        return this.prepareShieldMulti([asset]);
    }

    async prepareShieldMulti(tokens: AssetAmount[]): Promise<TxData[]> {
        let builder = this.provider.shield();

        for (const token of tokens) {
            builder = this.addShield(token.asset, token.amount, builder);
        }

        const txData = builder.build();

        return txData.map((tx) => ({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        }));
    }

    private addShield(asset: AssetId, amount: bigint, builder: ShieldBuilder) {
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
        return this.prepareUnshieldMulti([token], to);
    }

    async prepareUnshieldMulti(tokens: AssetAmount[], to: `0x${string}`): Promise<RGPrivateOperation> {
        let erc20Unshields: AssetAmount<ERC20AssetId>[] = [];
        let nativeAmount: bigint = 0n;
        for (const token of tokens) {
            //? Need to account for the 0.025% fee on unshield.
            //? I've decided it's more intuitive to add the fee on top of the 
            //? unshield so that the user receives the exact amount they expect 
            //? after fees
            const unshieldAmount = (token.amount * BPS_DENOMINATOR) / (BPS_DENOMINATOR - BigInt(this.chain.unshieldFeeBps));

            if (token.asset.__type === 'erc20') {
                erc20Unshields.push({
                    asset: token.asset,
                    amount: unshieldAmount,
                });
            } else if (token.asset.__type === 'native') {
                nativeAmount += token.amount;
                //? Need to unshield as ERC20 then unwrap
                erc20Unshields.push({
                    asset: { __type: 'erc20', contract: this.chain.wrappedBaseToken },
                    amount: unshieldAmount,
                })
            } else {
                throw new Error("Unsupported asset type for unshielding");
            }
        }

        //? Safe because of above tokenGuard
        const entries = await this.pool.drain(this.provider, erc20Unshields as AssetAmount<ERC20AssetId>[]);
        let builder = this.provider.transact();

        for (const e of entries) {
            builder = builder.unshield(e.signer, to, e.asset, e.amount);
        }

        return { __type: 'privateOperation', builder, nativeAmount, to };
    }

    async prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        return this.prepareTransferMulti([token], to);
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
        if (!this.smartAccount) throw new Error("No smart account configured for broadcast");
        if (!this.smartAccountSigner) throw new Error("No smart account signer configured for broadcast");

        //? If there's a native unshield, add the unwrap tail call
        let calls: Call[] = [];
        if (op.nativeAmount && op.to) {
            const data = encodeFunctionData({
                abi: [{
                    name: "withdraw",
                    type: "function",
                    inputs: [{ name: "wad", type: "uint256" }],
                }],
                functionName: "withdraw",
                args: [op.nativeAmount],
            });

            calls.push({
                target: this.chain.wrappedBaseToken,
                value: "0x00",
                data: data
            });
        }

        const signableUserOp = await this.provider.prepareUserOp(
            op.builder,
            this.bundler,
            this.smartAccount,
            this.pool.primary,
            this.chain.wrappedBaseToken,
            calls
        );

        const signedUserOp = await signableUserOp.sign(this.smartAccountSigner);
        const userOpHash = await this.bundler.sendUserOperation(signedUserOp);

        console.log(`Broadcasted user operation with hash: ${userOpHash}`);

        const receipt = await this.bundler.waitForReceipt(userOpHash);
        console.log(`User operation included: ${JSON.stringify(receipt)}`);

        // Sync after broadcast to update state.
        await this.provider.sync();
    }
};

function tokenGuard(token: AssetAmount) {
    const asset = token.asset;

    if (asset.__type !== 'erc20') {
        throw new Error("Only ERC20 tokens are supported for this operation");
    }
}
