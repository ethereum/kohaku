import { getContractAddress } from 'viem';
import type { Address, Hex } from '../interfaces';
import type { CreationPrivileges } from '../types';
import { parseCreationEntries } from './creation-layout';
import { assertBytes, assertBytes32, normalizeAddress } from './guards';

/**
 * The account a `CREATE2` of the proxy creation code produces, checksummed, and the privilege entries that code writes.
 * Bytecode that does not parse as the proxy layout throws a `RangeError`; the entries carry slots, not the privileged addresses.
 */
export function creationPrivileges(factory: Address, bytecode: Hex, salt: Hex): CreationPrivileges {
  const from = normalizeAddress(factory, 'factory');

  assertBytes(bytecode, 'bytecode');
  assertBytes32(salt, 'salt');

  const entries = parseCreationEntries(bytecode);

  return { account: getContractAddress({ opcode: 'CREATE2', from, salt, bytecode }), entries };
}
