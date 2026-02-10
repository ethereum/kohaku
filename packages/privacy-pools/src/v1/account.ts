import { Address } from 'ox/Address';
import { Account } from '@kohaku-eth/plugins/account';
import { PPv1PrivateOperation } from '.';
import { PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv1Address = Address;

export type PPv1Account = Account<
    PPv1Address,
    PPv1PrivateOperation,
    {
        shield: true,
        shieldMulti: true,
        unshield: true,
        unshieldMulti: true,
    }
>;

export const createAccount = (): PPv1Account => {
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
