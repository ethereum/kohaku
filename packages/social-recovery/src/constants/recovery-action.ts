import { toFunctionSelector } from 'viem';
import type { AbiFunctionItem, Address, Hex } from '../interfaces/records';
import { FORMATS_ZERO_ADDRESS } from './formats';

/** The ERC-165 id of the policy-action interface. */
export const POLICY_ACTION_INTERFACE_ID: Hex = '0x59cd148e';

/** The account's own privilege write, `setAddrPrivilege(address addr, bytes32 priv)`. */
export const RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI = [
  {
    type: 'function',
    name: 'setAddrPrivilege',
    stateMutability: 'payable',
    inputs: [
      { name: 'addr', type: 'address' },
      { name: 'priv', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The `setAddrPrivilege` selector, derived from the function's canonical signature. */
export const RECOVERY_ACTION_SET_ADDR_PRIVILEGE_SELECTOR: Hex = toFunctionSelector(RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI[0]);

/** The action contract's views the action part reads: the policy-action interface and the recovery action's `holdsAnyPrivilege`. */
export const RECOVERY_ACTION_VIEWS_ABI = [
  {
    type: 'function',
    name: 'supportsAccount',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ name: '_supported', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isAuthority',
    stateMutability: 'view',
    inputs: [
      { name: '_account', type: 'address' },
      { name: '_authority', type: 'address' },
    ],
    outputs: [{ name: '_holds', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isAuthorized',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ name: '_authorized', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'supportsInterface',
    stateMutability: 'view',
    inputs: [{ name: '_interfaceId', type: 'bytes4' }],
    outputs: [{ name: '_supported', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '_actionName', type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '_actionVersion', type: 'string' }],
  },
  {
    type: 'function',
    name: 'holdsAnyPrivilege',
    stateMutability: 'view',
    inputs: [
      { name: '_account', type: 'address' },
      { name: '_candidate', type: 'address' },
    ],
    outputs: [{ name: '_reserved', type: 'bool' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The recovery action's `MANAGER()`, the manager whose attempts it spends. */
export const RECOVERY_ACTION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'MANAGER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '_manager', type: 'address' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** A boolean view's return data: one word holding 0 or 1. */
export const RECOVERY_ACTION_BOOL_RETURN_ABI = [{ type: 'bool' }] as const;

/** A string view's return data: one dynamic string. */
export const RECOVERY_ACTION_STRING_RETURN_ABI = [{ type: 'string' }] as const;

/** The Ambire action's payload, `abi.encode(Handover)`: the new authority, then the removed one, and nothing after them. */
export const RECOVERY_ACTION_HANDOVER_ABI = [
  { name: 'newAuthority', type: 'address' },
  { name: 'removedAuthority', type: 'address' },
] as const;

/** The payload layout's name in a refusal. */
export const RECOVERY_ACTION_HANDOVER_LAYOUT = '(address newAuthority, address removedAuthority)';

/** The privilege value the disarming call writes under the kit slot, which grants nothing. */
export const RECOVERY_ACTION_DISARMED_VALUE: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** The zero address, which a handover may name on neither side. */
export const RECOVERY_ACTION_ZERO_ADDRESS = FORMATS_ZERO_ADDRESS;

/** The address the action's views are read from. */
export const RECOVERY_ACTION_READ_FROM = FORMATS_ZERO_ADDRESS;

/**
 * The address under which the pinned account implementation keeps its fallback handler in `privileges`.
 * The account delegatecalls that handler on any selector it does not know, and asks it about any interface id it does not know.
 */
export const RECOVERY_ACTION_FALLBACK_HANDLER_SLOT: Address = '0x0000000000000000000000000000000000006969';

/** The account's privilege read, `privileges(address addr) returns (bytes32 privilege)`. */
export const RECOVERY_ACTION_PRIVILEGES_ABI = [
  {
    type: 'function',
    name: 'privileges',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: 'privilege', type: 'bytes32' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** A word view's return data: one bytes32. */
export const RECOVERY_ACTION_WORD_RETURN_ABI = [{ type: 'bytes32' }] as const;
