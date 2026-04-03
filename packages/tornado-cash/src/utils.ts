import { poseidon } from "maci-crypto/build/ts/hashing";
import { getAddress } from "viem";
import { Address } from "./interfaces/types.interface";
import { INote } from "./plugin/interfaces/protocol-params.interface";

/**
 * Given a note, computes it commitment
 *
 */
export function commitment({ balance: value, label, precommitment }: INote): bigint {
  return poseidon([value, label, precommitment]);
}

/**
 * Converts an Address type to a hex string
 */
export function addressToHex(address: Address, padding = 40): `0x${string}` {
  return `0x${address.toString(16).padStart(padding, '0')}`;
}

/**
 * Converts an string type to a Address
 */
export function stringToAddress(addressString: string): Address {
  return BigInt(getAddress(addressString));
}

