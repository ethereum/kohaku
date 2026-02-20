import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { CreatePluginFn, PrivateOperation, PublicOperation, AssetAmount, PluginInstance } from "@kohaku-eth/plugins";
import { Address } from 'cluster';


/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv2Address = Address;

export type PPv2Credential = {
    type: 'private-key';
    privateKey: string;
    accountIndex: number;
} | {
    type: 'mnemonic';
    mnemonic: string;
    accountIndex: number;
};

export type PPv2Instance = PluginInstance<
    PPv2Address & string,
    {
        assetAmounts: {
            input: AssetAmount,
            internal: AssetAmount,
            output: AssetAmount,
        },
        credential: PPv2Credential,
        privateOp: PPv2PrivateOperation,
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

export type PPv2BroadcasterParameters = {
    broadcasterUrl: string;
    // TODO: add remaining url params
};
export type PPv2PrivateOperation = PrivateOperation & { bar: 'hi' };
export type PPv2Broadcaster = Broadcaster<PPv2BroadcasterParameters>;
export type PPv2PluginParameters = { foo: 'bar' }; // TODO: add deployment params 

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createPPv2Plugin: CreatePluginFn<PPv2Instance, PPv2PluginParameters> = (host, params) => {
    // setup privacy pools v2 plugin here
    const pubKey = "" as unknown as PPv2Address & string;

    return {
        instanceId: () => Promise.resolve(pubKey),
        balance: () => Promise.resolve([]),
        prepareShield: () => Promise.resolve({} as PublicOperation),
        prepareShieldMulti: () => Promise.resolve({} as PublicOperation),
        prepareTransfer: () => Promise.resolve({} as PPv2PrivateOperation),
        prepareTransferMulti: () => Promise.resolve({} as PPv2PrivateOperation),
        prepareUnshield: () => Promise.resolve({} as PPv2PrivateOperation),
        prepareUnshieldMulti: () => Promise.resolve({} as PPv2PrivateOperation),
    };
};
