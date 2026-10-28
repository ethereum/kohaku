import { toFunctionSelector } from 'viem';
import { FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS } from './formats';

/** The `ProofPlace` struct's members, in their on-chain order. */
export const FORMATS_PROOF_PLACE_COMPONENTS = [
  { name: 'place', type: 'uint256' },
  { name: 'method', type: 'address' },
  { name: 'config', type: 'bytes' },
  { name: 'salt', type: 'bytes32' },
  { name: 'proof', type: 'bytes' },
] as const;

/** A proof place's ABI parameters: one tuple, so its encoding opens with an offset word. */
export const FORMATS_PROOF_PLACE_ABI = [{ name: 'proof', type: 'tuple', components: FORMATS_PROOF_PLACE_COMPONENTS }] as const;

/** The manager's `startAttempt(AttemptRequest)` function. */
export const FORMATS_START_ATTEMPT_ABI = [
  {
    type: 'function',
    name: 'startAttempt',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'action', type: 'address' },
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'setupBody', type: 'bytes' },
          { name: 'payload', type: 'bytes' },
          { name: 'order', type: 'tuple', components: FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS },
          { name: 'validUntil', type: 'uint48' },
          { name: 'proofs', type: 'tuple[]', components: FORMATS_PROOF_PLACE_COMPONENTS },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** The manager's `cancelByProofs(CancelRequest)` function. */
export const FORMATS_CANCEL_BY_PROOFS_ABI = [
  {
    type: 'function',
    name: 'cancelByProofs',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'action', type: 'address' },
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'setupBody', type: 'bytes' },
          { name: 'validUntil', type: 'uint48' },
          { name: 'proofs', type: 'tuple[]', components: FORMATS_PROOF_PLACE_COMPONENTS },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** The `startAttempt` selector, derived from the function's canonical signature. */
export const FORMATS_START_ATTEMPT_SELECTOR = toFunctionSelector(FORMATS_START_ATTEMPT_ABI[0]);

/** The `cancelByProofs` selector, derived from the function's canonical signature. */
export const FORMATS_CANCEL_BY_PROOFS_SELECTOR = toFunctionSelector(FORMATS_CANCEL_BY_PROOFS_ABI[0]);

/** The string literal a kit slot's preimage opens with. */
export const FORMATS_KIT_SLOT_TAG = 'kit';

/** The kit slot's preimage parameters, `abi.encode("kit", action)` with the tag typed `string` as the contract spells it. */
export const FORMATS_KIT_SLOT_PREIMAGE_ABI = [{ type: 'string' }, { type: 'address' }] as const;

/** The kit binding's preimage parameters: the action and its validator data. */
export const FORMATS_KIT_BINDING_PREIMAGE_ABI = [{ type: 'address' }, { type: 'bytes' }] as const;

/** The validator data the kit binds, empty since the action reads nothing from it. */
export const FORMATS_KIT_BINDING_DATA = '0x';

/** The number of bytes of a word an address occupies, taken from its low end. */
export const FORMATS_ADDRESS_BYTES = 20;
