import { AssetAmount, CreatePluginFn, Host, Instance, PrivateOperation } from "@kohaku-eth/plugins";
import { Plugin } from "@kohaku-eth/plugins";
import { createRailgunAccount } from "./account/base";
import { createRailgunIndexer } from "./indexer/base";
import { getNetworkConfig } from "./config";
import { IndexerLoadData } from "./indexer/storage";
import { CachedAccountStorage } from "./account/storage";
import { KeyConfig } from "./account/keys";
import { RailgunAddress } from "./account/actions/address";

// export type RGBroadcaster = Broadcaster<{ broadcasterUrl: string }>;
export type RGPluginParameters = { foo: 'bar' };
export type RailgunPlugin = Plugin<
    "railgun",
    RGInstance,
    RGPrivateOperation,
    Host,
    never, // no broadcaster
    RGPluginParameters
>;
export type RGPrivateOperation = PrivateOperation & { bar: 'hi' };
export type RGInstance = Instance<
    RailgunAddress,
    {
        input: AssetAmount,
        internal: AssetAmount,
        output: AssetAmount,
    },
    RGPrivateOperation,
    { shield: true, shieldMulti: true, transfer: true, transferMulti: true, unshield: true, unshieldMulti: true }
>;

export const createRailgunPlugin: CreatePluginFn<RailgunPlugin> = async (host, params) => {
    // TODO: get chainId from network config
    const chainId = await host.provider.getChainId();
    const network = getNetworkConfig(chainId.toString() as `${bigint}`);
    const indexer = await createRailgunIndexer({
        network,
        // temp storage shim, can be reduced later
        storage: {
            read: async () => JSON.parse(host.storage.get('indexer') ?? '{}') as IndexerLoadData,
            write: async (data) => host.storage.set('indexer', JSON.stringify(data)),
        },
    });
    const instances: RGInstance[] = [];
    const createInstance = async () => {
        const credential = null as unknown as KeyConfig; // TODO load from storage
        const account = await createRailgunAccount({
            indexer,
            credential,
            network,
            storage: {
                read: async () => JSON.parse(host.storage.get('account') ?? '{}') as CachedAccountStorage,
                write: async (data) => host.storage.set('account', JSON.stringify(data)),
            } 
        });

        const instance: RGInstance = {
            account: account.getRailgunAddress,
            // TODO: hook these to the proper functions
            balance: undefined as never,
            shield: undefined as never,
            shieldMulti: undefined as never,
            transfer: undefined as never,
            transferMulti: undefined as never,
            unshield: undefined as never,
            unshieldMulti: undefined as never,
        };

        instances.push(instance);

        return instance;
    };

    const broadcaster = undefined as never;

    return {
        instances: () => instances,
        createInstance,
        broadcaster,
        plugin_name: "railgun",
    } as RailgunPlugin;
};