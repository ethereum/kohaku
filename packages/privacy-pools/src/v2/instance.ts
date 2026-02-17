import { Address } from 'ox/Address';
import { Instance } from '@kohaku-eth/plugins/instance';
import { PPv2PrivateOperation } from '.';
import { AssetAmount, PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv2Address = Address;

export type PPv2Instance = Instance<
    PPv2Address,
    {
        input: AssetAmount,
        internal: AssetAmount,
        output: AssetAmount,
    },
    PPv2PrivateOperation,
    {
        shield: true,
        shieldMulti: true,
        transfer: true,
        transferMulti: true,
        unshield: true,
        unshieldMulti: true,
    }
>;

export const createInstance = (): PPv2Instance => {
    const pubKey = "" as Address;

    return {
        account: () => Promise.resolve(pubKey),
        balance: () => Promise.resolve([]),
        shield: () => Promise.resolve({} as PublicOperation),
        shieldMulti: () => Promise.resolve({} as PublicOperation),
        transfer: () => Promise.resolve({} as PPv2PrivateOperation),
        transferMulti: () => Promise.resolve({} as PPv2PrivateOperation),
        unshield: () => Promise.resolve({} as PPv2PrivateOperation),
        unshieldMulti: () => Promise.resolve({} as PPv2PrivateOperation),
    };
};
