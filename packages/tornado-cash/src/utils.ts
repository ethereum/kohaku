import { getAddress } from "viem";
import { Address } from "./interfaces/types.interface";

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

