import { PPv1Account } from './account';
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { Plugin, CreatePluginFn, Host, PrivateOperation } from "@kohaku-eth/plugins";

export type PPv1BroadcasterParameters = {
    broadcasterUrl: string;
    // TODO: add remaining url params
};
export type PPv1PrivateOperation = PrivateOperation & { bar: 'hi' };
export type PPv1Broadcaster = Broadcaster<PPv1BroadcasterParameters>;
export type PPv1PluginParameters = { foo: 'bar' }; // TODO: add deployment params 
export type PPv1Plugin = Plugin<"privacy-pools-v1", PPv1Account, PrivateOperation, Host, PPv1Broadcaster, PPv1PluginParameters>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createPPv1Plugin: CreatePluginFn<PPv1Plugin> = (host, params) => {
    // setup privacy pools v1 plugin here

    // ppv1 supports single account
    const account = {} as PPv1Account;
    const broadcaster = {} as PPv1Broadcaster;

    return {
        accounts: () => [account],
        createAccount: () => account,
        broadcaster,
        plugin_name: "privacy-pools-v1",
    };
};
