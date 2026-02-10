/**
 * @fileoverview Example minimal tornadocash plugin.
 * 
 * Demonstrates how to implement a subset of the Pluguin interface, and how to 
 * enforce both compile-time and run-time checks for supported assets.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Account } from "../src/account/base";
import { Broadcaster } from "../src/broadcaster/base";
import { Plugin, CreatePluginFn, Host, PrivateOperation, PublicOperation, AssetAmount } from "../src/index";

export type TCPrivateOperation = PrivateOperation & { bar: 'hi' };
// private account index (derivation index)
// 0 by default
export type TornadoAddress = `${number}`;
export type TCAccount = Account<
    TornadoAddress,
    TCPrivateOperation,
    { shield: true, unshield: true }
>;

export type TCPluginParameters = { foo: 'bar' };
export type TBroadcaster = Broadcaster<{ broadcasterUrl: string }>;
export type TornadoPlugin = Plugin<"tornado", TCAccount, TCPrivateOperation, Host, TBroadcaster, TCPluginParameters>;

export const createTornadoPlugin: CreatePluginFn<TornadoPlugin> = (host, params) => {
    // setup tornado plugin here
    const accounts: TCAccount[] = [];
    const createAccount = () => {
        const account = {
            account: () => Promise.resolve("0"),
            balance(assets) {
                return Promise.resolve([] as Array<AssetAmount | undefined>);
            },
            shield(asset, to) {
                return Promise.resolve({} as PublicOperation);
            },
            unshield(asset, to) {
                return Promise.resolve({} as TCPrivateOperation);
            },
        } as TCAccount;

        accounts.push(account);

        return account;
    };

    const broadcaster = {} as TBroadcaster;

    return {
        accounts: () => accounts,
        createAccount,
        broadcaster,
        plugin_name: "tornado",
    };
};

const exampleUsage = async () => {

    const host: Host = {} as Host;

    const plugin = await createTornadoPlugin(host, {});
    const acc = await plugin.createAccount();

    const address = await acc.account();
    const balance = await acc.balance(["erc20:0x0000000000000000000000000000000000000000"]);

    const amount = balance[0];
    const preparedShield = await acc.shield(amount, "0");

    // acc.shield();
    // acc.unshield();
    // // acc.
    // plugin.broadcaster.broadcast(operation);
};
