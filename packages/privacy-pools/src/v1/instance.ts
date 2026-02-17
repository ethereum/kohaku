import { Address } from 'ox/Address';
import { PPv1PrivateOperation } from '.';
import { AssetAmount, Instance, PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv1Address = Address;

export type PPv1Instance = Instance<
    PPv1Address,
    {
        input: AssetAmount,
        internal: AssetAmount,
        output: AssetAmount,
    },
    PPv1PrivateOperation,
    {
        shield: true,
        shieldMulti: true,
        unshield: true,
        unshieldMulti: true,
    }
>;

export const createInstance = (): PPv1Instance => {
    const pubKey = "" as Address;

    return {
        account: () => Promise.resolve(pubKey),
        balance: () => Promise.resolve([]),
        shield: () => Promise.resolve({} as PublicOperation),
        shieldMulti: () => Promise.resolve({} as PublicOperation),
        unshield: () => Promise.resolve({} as PPv1PrivateOperation),
        unshieldMulti: () => Promise.resolve({} as PPv1PrivateOperation),
    };
};
