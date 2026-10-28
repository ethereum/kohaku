import type { AbiFunctionItem, Hex } from '../interfaces/records';
import { FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS, FORMATS_ZERO_ADDRESS } from './formats';
import { FORMATS_CANCEL_BY_PROOFS_ABI, FORMATS_START_ATTEMPT_ABI } from './formats-requests';

/** The ERC-165 id of the method interface: the XOR of the selectors of `verify`, `trustedParties`, `supportsInterface`, `name` and `version`. */
export const POLICY_METHOD_INTERFACE_ID: Hex = '0xf057a368';

/** The manager's writes other than the two request submissions, which the request codecs encode. */
export const POLICY_MANAGER_WRITES_ABI = [
  {
    type: 'function',
    name: 'commitSetup',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'action', type: 'address' },
      { name: 'setupCommitment', type: 'bytes32' },
      { name: 'nonce', type: 'uint64' },
      { name: 'publicMetadata', type: 'bytes' },
      { name: 'privateMetadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'clearSetup',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'action', type: 'address' },
      { name: 'nonce', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelByOwner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'action', type: 'address' },
      { name: 'attemptId', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelByVeto',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'action', type: 'address' },
      { name: 'attemptId', type: 'uint64' },
      { name: 'method', type: 'address' },
    ],
    outputs: [],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The manager's `Attempt` struct's members, in their on-chain order; `state` is the `AttemptState` enum as `uint8`. */
export const POLICY_MANAGER_ATTEMPT_COMPONENTS = [
  { name: 'attemptId', type: 'uint64' },
  { name: 'setupNonce', type: 'uint64' },
  { name: 'consumableAfter', type: 'uint48' },
  { name: 'state', type: 'uint8' },
  { name: 'ignoresPause', type: 'bool' },
  { name: 'payloadHash', type: 'bytes32' },
  { name: 'order', type: 'tuple', components: FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS },
  { name: 'usedMethods', type: 'address[]' },
] as const;

/** The manager's `stateOf(account, action)` view. */
export const POLICY_MANAGER_STATE_OF_ABI = [
  {
    type: 'function',
    name: 'stateOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'action', type: 'address' },
    ],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'setupCommitment', type: 'bytes32' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'nextAttemptId', type: 'uint64' },
          { name: 'setupCommittedAtBlock', type: 'uint48' },
          { name: 'attempt', type: 'tuple', components: POLICY_MANAGER_ATTEMPT_COMPONENTS },
        ],
      },
    ],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The manager's `hashApproval(request, place)` view, over the request `startAttempt` takes. */
export const POLICY_MANAGER_HASH_APPROVAL_ABI = [
  {
    type: 'function',
    name: 'hashApproval',
    stateMutability: 'view',
    inputs: [FORMATS_START_ATTEMPT_ABI[0].inputs[0], { name: 'place', type: 'uint256' }],
    outputs: [{ name: 'digest', type: 'bytes32' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The manager's `hashCancel(request, place)` view, over the request `cancelByProofs` takes. */
export const POLICY_MANAGER_HASH_CANCEL_ABI = [
  {
    type: 'function',
    name: 'hashCancel',
    stateMutability: 'view',
    inputs: [FORMATS_CANCEL_BY_PROOFS_ABI[0].inputs[0], { name: 'place', type: 'uint256' }],
    outputs: [{ name: 'digest', type: 'bytes32' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The manager's ERC-5267 `eip712Domain()` view. */
export const POLICY_MANAGER_EIP712_DOMAIN_ABI = [
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The `supportsInterface(bytes4)` view the manager and every method module declare alike. */
export const POLICY_MANAGER_SUPPORTS_INTERFACE_ABI = [
  {
    type: 'function',
    name: 'supportsInterface',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: 'supported', type: 'bool' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The `name()` view the manager and every method module declare alike. */
export const POLICY_MANAGER_NAME_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: 'name', type: 'string' }] },
] as const satisfies readonly AbiFunctionItem[];

/** The `version()` view the manager and every method module declare alike. */
export const POLICY_MANAGER_VERSION_ABI = [
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: 'version', type: 'string' }] },
] as const satisfies readonly AbiFunctionItem[];

/** A method module's `trustedParties()` view. */
export const POLICY_MANAGER_TRUSTED_PARTIES_ABI = [
  {
    type: 'function',
    name: 'trustedParties',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'admin', type: 'address' },
      { name: 'pendingAdmin', type: 'address' },
      { name: 'trustedKeys', type: 'bytes32[]' },
      { name: 'pauseHolder', type: 'address' },
      { name: 'pendingPauseHolder', type: 'address' },
    ],
  },
] as const satisfies readonly AbiFunctionItem[];

/** A method module's `paused()` view, which a module that carries no stop does not declare. */
export const POLICY_MANAGER_PAUSED_ABI = [
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: 'isPaused', type: 'bool' }] },
] as const satisfies readonly AbiFunctionItem[];

/** The only return a stopped module's `paused()` and a supporting module's ERC-165 probe count: exactly the ABI encoding of `true`. */
export const POLICY_MANAGER_TRUE_WORD: Hex = '0x0000000000000000000000000000000000000000000000000000000000000001';

/** The width of an ERC-165 interface id, in bytes. */
export const POLICY_MANAGER_INTERFACE_ID_SIZE = 4;

/** The address every view is read from, since no view of the manager or a module depends on its caller. */
export const POLICY_MANAGER_READ_FROM = FORMATS_ZERO_ADDRESS;

/** The result of a module read that answered nothing. */
export const POLICY_MANAGER_UNANSWERED = Object.freeze({ answered: false } as const);
