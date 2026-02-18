/**
 * @fileoverview Example minimal tornadocash plugin.
 * 
 * Demonstrates how to implement a subset of the Plugin interface, and how to 
 * enforce both compile-time and run-time checks for supported assets.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PluginInstance } from "../src/instance/base";
import { Broadcaster } from "../src/broadcaster/base";
import { Plugin, CreatePluginFn, Host, PrivateOperation, PublicOperation, AssetAmount } from "../src/index";

export const TC_SAMPLE_CONFIG = {
    eth: {
        asset: `eip155:1:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
        amounts: [100000000000000000n, 1000000000000000000n] as const,
    },
    dai: {
        asset: `eip155:1:erc20:0x6B175474E89094C44Da98b954EedeAC495271d0F`,
        amounts: [100000000000000000000n, 1000000000000000000000n] as const,
    },
    usdc: {
        asset: `eip155:1:erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`,
        amounts: [100000000000000000000n, 1000000000000000000000n, 10000000000000000000000n] as const,
    },
} as const;

export type TCSampleConfigType = typeof TC_SAMPLE_CONFIG;
export type TCAsset = TCSampleConfigType[keyof TCSampleConfigType]['asset']
export type TCAssetId = keyof TCSampleConfigType;
export type TCAssetAmount<Asset extends TCAssetId = TCAssetId> = AssetAmount<TCSampleConfigType[Asset]['asset'], TCSampleConfigType[Asset]['amounts'][number]>;

export type TCPrivateOperation = PrivateOperation & { bar: 'hi' };
// private account index (derivation index)
// 0 by default
export type TornadoAddress = `${number}`;
export type TCInstance = PluginInstance<
    TornadoAddress,
    {
        input: TCAssetAmount,
        internal: TCAssetAmount,
        output: TCAssetAmount,
    },
    TCPrivateOperation,
    { prepareShield: true, prepareUnshield: true }
>;

export type TCPluginParameters = { foo: 'bar' };
export type TBroadcaster = Broadcaster<{ broadcasterUrl: string }>;
export type TornadoPlugin = Plugin<"tornado", TCInstance, TCPrivateOperation, Host, TBroadcaster, TCPluginParameters>;

export const createTornadoPlugin: CreatePluginFn<TornadoPlugin> = (host, params) => {
    // setup tornado plugin here
    const instances: TCInstance[] = [];
    const createInstance = () => {
        const instance = {
            instanceId: () => Promise.resolve("0"),
            balance(assets) {
                return Promise.resolve([] as Array<AssetAmount | undefined>);
            },
            prepareShield(asset, to) {
                return Promise.resolve({} as PublicOperation);
            },
            prepareUnshield(asset, to) {
                return Promise.resolve({} as TCPrivateOperation);
            },
        } as TCInstance;

        instances.push(instance);

        return instance;
    };

    const broadcaster = {} as TBroadcaster;

    return {
        instances: () => instances,
        createInstance,
        broadcaster,
        plugin_name: "tornado",
    };
};

const exampleUsage = async () => {
    const host: Host = {} as Host;

    const plugin = await createTornadoPlugin(host, {});
    const acc = await plugin.createInstance();

    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.prepareShield(amount);

    acc.prepareShield({ asset: 'eip155:1:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', amount: 100000000000000000n }, "0");

    acc.prepareShield({
        asset: 'eip155:1:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', amount: 100000000000000000n,
    }, "0")

    // acc.shield();
    // acc.unshield();
    // // acc.
    // plugin.broadcaster.broadcast(operation);
};
