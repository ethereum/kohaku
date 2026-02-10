import { Address } from 'ox/Address';
import { Account } from '@kohaku-eth/plugins/account';
import { PPv2PrivateOperation } from '.';
import { PublicOperation } from '@kohaku-eth/plugins';

/**
 * PPv1 uses Ethereum Addresses internally
 */
export type PPv2Address = Address;

export type PPv2Account = Account<
    PPv2Address,
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

export const createAccount = (): PPv2Account => {
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
