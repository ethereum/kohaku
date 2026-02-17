import { Address } from 'ox/Address';
import { PPv1PrivateOperation } from '.';
import { AssetAmount, ERC20AssetId, Instance, PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv1Address = Address;

export type PPv1AssetAmount = AssetAmount<ERC20AssetId>;

export type PPv1Instance = Instance<
    PPv1Address,
    {
        input: PPv1AssetAmount,
        internal: PPv1AssetAmount,
        output: PPv1AssetAmount,
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

// const x = createInstance();

// x.shield({
//     asset: {
//         __type: 'erc20',
//         contract: '0x0000000000000000000000000000000000000000',
//     },
//     amount: 100n,
// }, '0x1234567890abcdef');
