import { Address } from 'ox/Address';
import { PluginInstance } from '@kohaku-eth/plugins/instance';
import { PPv2PrivateOperation } from '.';
import { AssetAmount, PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv2Address = Address;

export type PPv2Instance = PluginInstance<
    PPv2Address,
    {
        input: AssetAmount,
        internal: AssetAmount,
        output: AssetAmount,
    },
    PPv2PrivateOperation,
    {
        prepareShield: true,
        prepareShieldMulti: true,
        prepareTransfer: true,
        prepareTransferMulti: true,
        prepareUnshield: true,
        prepareUnshieldMulti: true,
    }
>;

export const createInstance = (): PPv2Instance => {
    const pubKey = "" as Address;

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
