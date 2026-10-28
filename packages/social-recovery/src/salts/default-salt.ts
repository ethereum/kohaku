import { encodeAbiParameters, keccak256 } from 'viem';
import { FORMATS_PLACE_BITS, SALTS_DEFAULT_SALT_ABI } from '../constants';
import { assertUintNumber, normalizeAddress } from '../formats/guards';
import type { Address, Hex } from '../interfaces';

/** A credential's default salt, a pure function of the account and the place, recomputable on any device. */
export function defaultSalt(account: Address, place: number): Hex {
  const accountAddress = normalizeAddress(account, 'account');

  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return keccak256(encodeAbiParameters(SALTS_DEFAULT_SALT_ABI, [accountAddress, BigInt(place)]));
}
