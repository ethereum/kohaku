import { decodeAddress } from '../railgun/lib/key-derivation/bech32';

export const decodeRailgunAddress = (receiver: string) => {
  return decodeAddress(receiver);
};
