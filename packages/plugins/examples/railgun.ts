/* eslint-disable @typescript-eslint/no-unused-vars */
import { Account } from "../src/account/base";
import { Broadcaster } from "../src/broadcaster/base";
import { Plugin, CreatePluginFn, Host, PrivateOperation } from "../src/index";

export type RGBroadcasterParameters = {
    broadcasterUrl: string;
};
export type RGPrivateOperation = PrivateOperation & { bar: 'hi' };
export type RailgunAddress = `0zk${string}`;
export type RGAccount = Account<
    RailgunAddress,
    RGPrivateOperation,
    { shield: true, shieldMulti: true, transfer: true, transferMulti: true, unshield: true, unshieldMulti: true }
>;

export type RGBroadcaster = Broadcaster<RGBroadcasterParameters>;
export type RGPluginParameters = { foo: 'bar' };
export type RailgunPlugin = Plugin<"railgun", RGAccount, RGPrivateOperation, Host, RGBroadcaster, RGPluginParameters>;

export const createRailgunPlugin: CreatePluginFn<RailgunPlugin> = (host, params) => {
    // setup railgun plugin here
    const accounts: RGAccount[] = [];
    const createAccount = () => {
        const account = {} as RGAccount;

        accounts.push(account);

        return account;
    };

    const broadcaster = {} as RGBroadcaster;

    return {
        accounts: () => accounts,
        createAccount,
        broadcaster,
        plugin_name: "railgun",
    };
};

const exampleUsage = async () => {

    const host: Host = {} as Host;

    const plugin = await createRailgunPlugin(host, {});
    const acc = await plugin.createAccount();

    const address = await acc.account();
    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.shield(amount, "0zk123");

    // acc.shield();
    // acc.transfer();
    // // acc.
    // plugin.broadcaster.broadcast(operation);
};
