import { AssetAmount, Host, PluginInstance, PrivateOperation } from "@kohaku-eth/plugins";
import { JsPoiProvedTx, JsPoiProvider, JsSigner, JsSyncer, RailgunAddress } from "node_modules/railgun-js/dist/pkg/railgun_rs";
import { createBroadcaster, GrothProverAdapter, RemoteArtifactLoader } from "railgun-js";
import { EthereumProviderAdapter } from "./ethereum-provider";
import { TxData } from "@kohaku-eth/provider";

export type RGPrivateOperation = PrivateOperation & {
    operation: JsPoiProvedTx,
    // broadcaster: JsBroadcaster | undefined,
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

export async function createRailgunPlugin(host: Host): Promise<RGInstance> {
    const chain_id = await host.provider.getChainId();

    // TODO: Replace me with a loaded account
    const account1 = JsSigner.random(chain_id);
    // const account1 = new JsSigner(spending_key, viewing_key, chain_id);

    const provider = await newRailgunProvider(host, chain_id);

    // TODO: Enable broadcasting of transactions. Currently still unreliable
    // due to issues with the waku network. But worst comes to worst we can brute-force
    // it by retrying until it goes through.
    const broadcastManager = await createBroadcaster(chain_id);

    // TODO: How do we want to handle list keys?
    // 
    // Broadcasters require certain keys to perform transactions. In general
    // they require the ofac sanction key, but it's not like that's canonical.
    // We could have it user-customized?
    const list_key = provider.listKeys()[0];

    async function balance(assets: RailgunAddress[] | undefined): Promise<AssetAmount[]> {
        if (list_key === undefined) {
            throw new Error("No list key available for balance query");
        }
        const balance = await provider.balance(account1.address, list_key);
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

        return validBalance;
    }

    async function prepareShield(token: AssetAmount): Promise<TxData> {
        if (list_key === undefined) {
            throw new Error("No list key available for prepareShield");
        }

        const txData = provider.shield().shield(account1.address, { type: "Erc20", value: token.asset.contract }, token.amount).build();
        return {
            to: txData.to,
            data: txData.data,
            value: BigInt(txData.value)
        };
    }

    async function prepareUnshield(token: AssetAmount, to: `0x${string}`): Promise<RGPrivateOperation> {
        if (list_key === undefined) {
            throw new Error("No list key available for prepareUnshield");
        }

        const builder = provider.transact().unshield(account1, to, { type: "Erc20", value: token.asset.contract }, token.amount);
        const tx = await provider.build(builder);
        return {
            __type: 'privateOperation',
            operation: tx,
        };

        // const broadcaster = await broadcastManager.best_broadcaster_for_token();
        // if (broadcaster === undefined) {
        //     throw new Error("No broadcaster available for prepareUnshield");
        // }
        // const tx = await provider.build_broadcast(builder, account1, broadcaster.fee());
        // return {
        //     __type: 'privateOperation',
        //     operation: tx,
        //     broadcaster,
        // }
    }

    async function prepareTransfer(token: AssetAmount, to: RailgunAddress): Promise<RGPrivateOperation> {
        if (list_key === undefined) {
            throw new Error("No list key available for prepareTransfer");
        }

        const builder = provider.transact().transfer(account1, to, { type: "Erc20", value: token.asset.contract }, token.amount, "");
        const tx = await provider.build(builder);
        return {
            __type: 'privateOperation',
            operation: tx,
        };

        // const broadcaster = await broadcastManager.best_broadcaster_for_token();
        // if (broadcaster === undefined) {
        //     throw new Error("No broadcaster available for prepareUnshield");
        // }
        // const tx = await provider.build_broadcast(builder, account1, broadcaster.fee());
        // return {
        //     __type: 'privateOperation',
        //     operation: tx,
        //     broadcaster,
        // }
    }

    async function broadcastPrivateOperation(op: RGPrivateOperation): Promise<void> {
        const txData: TxData = {
            to: op.operation.to,
            data: op.operation.data,
            value: BigInt(op.operation.value),
        };

        // const broadcaster = op.broadcaster;
        // if (broadcaster === undefined) {
        //     throw new Error("No broadcaster available for broadcastPrivateOperation");
        // }
        // await provider.broadcast(broadcaster, op.operation);

    }
};

async function newRailgunProvider(host: Host, chain_id: bigint): Promise<JsPoiProvider> {
    const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";
    const rpcAdapter = new EthereumProviderAdapter(host.provider);
    const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
    const syncer = JsSyncer.newChained([
        JsSyncer.newSubsquid(chain_id),
        await JsSyncer.newRpc(rpcAdapter, chain_id, 10n),
    ]);

    return await JsPoiProvider.new(rpcAdapter, syncer, prover);
}

