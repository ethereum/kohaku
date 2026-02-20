import { AssetAmount, CreatePluginFn, PluginInstance, PrivateOperation } from "@kohaku-eth/plugins";
import { createRailgunAccount } from "./account/base";
import { createRailgunIndexer } from "./indexer/base";
import { getNetworkConfig } from "./config";
import { KeyConfig } from "./account/keys";
import { RailgunAddress } from "./account/actions/address";

export type RGPluginParameters = { credential: KeyConfig };
export type RGPrivateOperation = PrivateOperation & { bar: 'hi' };
export type RGInstance = PluginInstance<
    RailgunAddress,
    {
        credential: KeyConfig,
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

export const createRailgunPlugin: CreatePluginFn<RGInstance, RGPluginParameters> = async (host, params) => {
    const { provider } = host;
    const { credential } = params;

    const storage = <T extends object>(subspace: string) => ({
        get: async () => JSON.parse(host.storage.get(subspace) ?? '{}') as T,
        set: async (data: T) => host.storage.set(subspace, JSON.stringify(data)),
    });

    const chainId = await provider.getChainId();
    const network = getNetworkConfig(chainId.toString() as `${bigint}`);
    const indexer = await createRailgunIndexer({
        network,
        storage: storage('indexer'),
    });
    const account = await createRailgunAccount({
        indexer,
        credential,
        provider,
        network,
        storage: storage('account'),
    });

    return {
        instanceId: account.getRailgunAddress,
        balance: async (assets) => {
            return Promise.all(
                assets?.map(async (asset) => {
                    const tokenBalance = await account.getBalance(asset);

                    return {
                        asset,
                        amount: tokenBalance,
                    };
                }) ?? []
            );
        },
        prepareShield: undefined as never,
        prepareShieldMulti: undefined as never,
        prepareTransfer: undefined as never,
        prepareTransferMulti: undefined as never,
        prepareUnshield: undefined as never,
        prepareUnshieldMulti: undefined as never,
    };
};
