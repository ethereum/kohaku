import { encodeAddress } from '~/railgun/lib/key-derivation/bech32';
import { DerivedKeys } from '../keys';
import { ACCOUNT_CHAIN_ID, ACCOUNT_VERSION } from '~/config';

export type RailgunAddress = string;

export type GetRailgunAddressFn = () => Promise<RailgunAddress>;
export type GetRailgunAddress = { getRailgunAddress: GetRailgunAddressFn };

export type GetRailgunAddressFnParams = Pick<DerivedKeys, 'master' | 'viewing'>;

export const makeGetRailgunAddress = ({ master, viewing }: GetRailgunAddressFnParams): GetRailgunAddressFn => async () => {
    const { pubkey: viewingPublicKey } = await viewing.getViewingKeyPair();

    return encodeAddress({
        masterPublicKey: master,
        viewingPublicKey,
        chain: ACCOUNT_CHAIN_ID,
        version: ACCOUNT_VERSION,
    });
};