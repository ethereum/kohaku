/* eslint-disable @typescript-eslint/no-unused-vars */
import { Broadcaster } from "../src/broadcaster/base";
import { CreatePluginFn, Host, PrivateOperation, AssetAmount, PluginInstance } from "../src/index";

export type RGBroadcasterParameters = {
    broadcasterUrl: string;
};
export type RGPrivateOperation = PrivateOperation & { bar: 'hi' };
export type RailgunAddress = `0zk${string}`;
export type RGInstance = PluginInstance<
    RailgunAddress,
    {
        assetAmounts: {
            input: AssetAmount,
            internal: AssetAmount,
            output: AssetAmount,
        },
        privateOp: RGPrivateOperation,
        features: {
            prepareShield: true,
            prepareShieldMulti: true,
            prepareTransfer: true,
            prepareTransferMulti: true,
            prepareUnshield: true,
            prepareUnshieldMulti: true,
        }
    }
>;

export type RGBroadcaster = Broadcaster<RGBroadcasterParameters>;
export type RGPluginParameters = { foo: 'bar' };

export const createRailgunPlugin: CreatePluginFn<RGInstance, RGPluginParameters> = (host, params) => {
    const x = {} as RGInstance;

    return x;
};

const exampleUsage = async () => {
    const host: Host = {} as Host;
    const acc = await createRailgunPlugin(host, { foo: 'bar' });

    const address = await acc.instanceId();
    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.prepareShield(amount, "0zk123");

    acc.prepareShield({ asset: { __type: "erc20", contract: "0x0000000000000000000000000000000000000000" }, amount: 100n }, "0zk123");
};
