import { encodeAddress } from '~/railgun/lib/key-derivation/bech32';
import { DerivedKeys, deriveKeys, KeyConfig } from '../keys';
import { ACCOUNT_CHAIN_ID, ACCOUNT_VERSION } from '~/config';
import { toHex } from 'viem';

export type RailgunAddress = `0zk${string}`;

export type GetRailgunAddressFn = () => Promise<RailgunAddress>;
export type GetRailgunAddress = { getRailgunAddress: GetRailgunAddressFn };

export type GetRailgunAddressFnParams = Pick<DerivedKeys, 'master' | 'viewing'>;

export const makeGetRailgunAddress = ({ master, viewing }: GetRailgunAddressFnParams): GetRailgunAddressFn => async () => {
    const { pubkey: viewingPublicKey } = await viewing.getViewingKeyPair();
    console.log('viewingPublicKey', toHex(viewingPublicKey));

    return encodeAddress({
        masterPublicKey: master,
        viewingPublicKey,
        chain: ACCOUNT_CHAIN_ID,
        version: ACCOUNT_VERSION,
    });
};

/**
 * Get a Railgun address from a credential (mnemonic or private keys) without creating a full account.
 * This is useful when you only need the address and don't need to interact with the blockchain.
 *
 * @param credential - Key configuration (mnemonic or private keys)
 * @returns The Railgun address
 *
 * @example
 * ```ts
 * const address = await getRailgunAddress({
 *   type: 'mnemonic',
 *   mnemonic: 'test test test...',
 *   accountIndex: 0
 * });
 * ```
 */
export const getRailgunAddress = async (credential: KeyConfig): Promise<RailgunAddress> => {
    const { master, viewing } = await deriveKeys(credential);
    const getAddress = makeGetRailgunAddress({ master, viewing });

    return getAddress();
};
