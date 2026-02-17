/* eslint-disable @typescript-eslint/no-unused-vars */
import { Instance } from "../src/instance/base";
import { Broadcaster } from "../src/broadcaster/base";
import { Plugin, CreatePluginFn, Host, PrivateOperation, AssetAmount } from "../src/index";

export type RGBroadcasterParameters = {
    broadcasterUrl: string;
};
export type RGPrivateOperation = PrivateOperation & { bar: 'hi' };
export type RailgunAddress = `0zk${string}`;
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

export type RGBroadcaster = Broadcaster<RGBroadcasterParameters>;
export type RGPluginParameters = { foo: 'bar' };
export type RailgunPlugin = Plugin<"railgun", RGInstance, RGPrivateOperation, Host, RGBroadcaster, RGPluginParameters>;

export const createRailgunPlugin: CreatePluginFn<RailgunPlugin> = (host, params) => {
    // setup railgun plugin here
    const instances: RGInstance[] = [];
    const createInstance = () => {
        const instance = {} as RGInstance;

        instances.push(instance);

        return instance;
    };

    const broadcaster = {} as RGBroadcaster;

    return {
        instances: () => instances,
        createInstance,
        broadcaster,
        plugin_name: "railgun",
    };
};

const exampleUsage = async () => {

    const host: Host = {} as Host;

    const plugin = await createRailgunPlugin(host, {});
    const acc = await plugin.createInstance();

    const address = await acc.account();
    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.shield(amount, "0zk123");

    acc.shield({ asset: 'erc20:0x0000000000000000000000000000000000000000', amount: 100n }, "0zk123");

    // acc.shield();
    // acc.transfer();
    // // acc.
    // plugin.broadcaster.broadcast(operation);
};
