import { PPv2Account } from './accounts';
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { Plugin, CreatePluginFn, Host, PrivateOperation } from "@kohaku-eth/plugins";

export type PPv2BroadcasterParameters = {
    broadcasterUrl: string;
    // TODO: add remaining url params
};
export type PPv2PrivateOperation = PrivateOperation & { bar: 'hi' };
export type PPv2Broadcaster = Broadcaster<PPv2BroadcasterParameters>;
export type PPv2PluginParameters = { foo: 'bar' }; // TODO: add deployment params 
export type PPv2Plugin = Plugin<"privacy-pools-v2", PPv2Account, PrivateOperation, Host, PPv2Broadcaster, PPv2PluginParameters>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createPPv2Plugin: CreatePluginFn<PPv2Plugin> = (host, params) => {
    // setup privacy pools v2 plugin here

    // ppv2 supports single account
    const account = {} as PPv2Account;
    const broadcaster = {} as PPv2Broadcaster;

    return {
        accounts: () => [account],
        createAccount: () => account,
        broadcaster,
        plugin_name: "privacy-pools-v2",
    };
};
