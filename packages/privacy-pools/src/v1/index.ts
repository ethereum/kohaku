import { PPv1Instance } from './instance.js';
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { Plugin, CreatePluginFn, Host, PrivateOperation } from "@kohaku-eth/plugins";

export type PPv1BroadcasterParameters = {
    broadcasterUrl: string;
    // TODO: add remaining url params
};
export type PPv1PrivateOperation = PrivateOperation & { bar: 'hi' };
export type PPv1Broadcaster = Broadcaster<PPv1BroadcasterParameters>;
export type PPv1PluginParameters = { foo: 'bar' }; // TODO: add deployment params 
export type PPv1Plugin = Plugin<"privacy-pools-v1", PPv1Instance, PrivateOperation, Host, PPv1Broadcaster, PPv1PluginParameters>;

 
export const createPPv1Plugin: CreatePluginFn<PPv1Plugin> = (host, params) => {
    // setup privacy pools v1 plugin here

    // ppv1 supports single instance
    const instance = {} as PPv1Instance;
    const broadcaster = {} as PPv1Broadcaster;

    return {
        instances: () => [instance],
        createInstance: () => instance,
        broadcaster,
        plugin_name: "privacy-pools-v1",
        params,
    };
};
