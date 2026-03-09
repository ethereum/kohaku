import { AssetAmount, AssetId, Host, PluginInstance, PrivateOperation, Storage } from "@kohaku-eth/plugins";
import { JsBroadcaster, JsBroadcasterManager, JsPoiProvedTx, JsPoiProvider, JsSigner, JsSyncer, JsTransactionBuilder, RailgunAddress } from "node_modules/railgun-js/dist/pkg/railgun_rs";
import { createBroadcaster, GrothProverAdapter, RemoteArtifactLoader } from "railgun-js";
import { EthereumProviderAdapter } from "./ethereum-provider";
import { TxData } from "@kohaku-eth/provider";

export type RGPrivateOperation = PrivateOperation & {
    operation: JsPoiProvedTx,
    broadcaster: JsBroadcaster,
    feeToken: `0x${string}`,
};

export type RGInstance = PluginInstance<
    RailgunAddress,
    {
        // assetAmounts: {
        //     input: AssetAmount,
        //     internal: AssetAmount,
        //     output: AssetAmount,
        // },
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

export class RailgunPlugin implements RGInstance {
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
    ) { }

    addInternalSigner(spendingKey: `0x${string}`, viewingKey: `0x${string}`) {
        const signer = new JsSigner(spendingKey, viewingKey, this.chainId);
        this.internalSigners.push(signer);
    }

    async instanceId(): Promise<RailgunAddress> {
        return this.signer.address;
    }

    // TODO: Once tags are implemented, enable return poiStatus for each item
    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        await this.provider.sync();
        const balance = await this.provider.balance(this.signer.address, LIST_KEY);
        const validBalance: AssetAmount[] = balance
            .filter((b) => b.poiStatus === "Valid")
            .filter((b) => b.balance > 0n)
            .filter((b) => b.assetId.type === "Erc20")
            .map((b) => ({
                asset: {
                    __type: 'erc20',
                    //? Safe to cast since we filter for Erc20 above
                    contract: b.assetId.value as `0x${string}`,
                },
                amount: b.balance,
            }));

        const filteredBalance: AssetAmount[] = validBalance.filter((b) => {
            if (assets === undefined) {
                return true;
            }
            return assets.some((a) => a.__type === 'erc20' && a.contract === b.asset.contract);
        });

        return filteredBalance;
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

        const builder = this.provider
            .transact()
            .unshield(this.signer, to, { type: "Erc20", value: token.asset.contract }, token.amount);

        const operation = await this.buildWithBroadcaster(builder);
        return operation;
    }

    async prepareUnshieldMulti(tokens: AssetAmount[], to: `0x${string}`): Promise<RGPrivateOperation> {
        let builder = this.provider.transact();

        for (const token of tokens) {
            tokenGuard(token);
            builder = builder.unshield(this.signer, to, { type: "Erc20", value: token.asset.contract }, token.amount);
        }

        const operation = await this.buildWithBroadcaster(builder);
        return operation;
    }

    async prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        tokenGuard(token);

        const builder = this.provider
            .transact()
            .transfer(this.signer, to, { type: "Erc20", value: token.asset.contract }, token.amount, "");
        const operation = await this.buildWithBroadcaster(builder);
        return operation;
    }

    async prepareTransferMulti(tokens: AssetAmount[], to: RailgunAddress): Promise<RGPrivateOperation> {
        let builder = this.provider.transact();

        for (const token of tokens) {
            tokenGuard(token);
            builder = builder.transfer(this.signer, to, { type: "Erc20", value: token.asset.contract }, token.amount, "");
        }

        const operation = await this.buildWithBroadcaster(builder);
        return operation;
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
    async broadcastPrivateOperation(op: RGPrivateOperation): Promise<void> {
        const broadcaster = op.broadcaster;
        await this.provider.broadcast(broadcaster, op.operation);
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

    private saveState() {
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
