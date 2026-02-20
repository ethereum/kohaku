/**
 * @fileoverview Example minimal tornadocash plugin.
 * 
 * Demonstrates how to implement a subset of the Plugin interface, and how to 
 * enforce both compile-time and run-time checks for supported assets.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Broadcaster } from "../src/broadcaster/base";
import { CreatePluginFn, Host, PrivateOperation, PublicOperation, AssetAmount, PluginInstance } from "../src/index";

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
        assetAmounts: {
            input: TCAssetAmount,
            internal: TCAssetAmount,
            output: TCAssetAmount,
        },
        privateOp: TCPrivateOperation,
        features: {
            prepareShield: true,
            prepareUnshield: true,
        },
    }
>;

export type TCPluginParameters = { foo: 'bar' };
export type TBroadcaster = Broadcaster<{ broadcasterUrl: string }>;

export const createTornadoPlugin: CreatePluginFn<TCInstance, TCPluginParameters> = (host, params) => {

    return {
        instanceId: async () => "0",
        balance: async () => [],
        prepareShield: async () => ({}),
        prepareUnshield: async () => ({}),
    };
};

const exampleUsage = async () => {
    const host: Host = {} as Host;

    const acc = await createTornadoPlugin(host, { foo: 'bar' });

    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.prepareShield(amount);

    acc.prepareShield({ asset: 'eip155:1:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', amount: 100000000000000000n }, "0");

    acc.prepareShield({
        asset: 'eip155:1:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', amount: 100000000000000000n,
    }, "0")
};
