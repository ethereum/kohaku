import { encodeAbiParameters, getAddress, keccak256, size, slice } from 'viem';
import {
  FORMATS_ADDRESS_BYTES,
  FORMATS_KIT_BINDING_DATA,
  FORMATS_KIT_BINDING_PREIMAGE_ABI,
  FORMATS_KIT_SLOT_PREIMAGE_ABI,
  FORMATS_KIT_SLOT_TAG,
} from '../constants';
import type { Address, Hex } from '../interfaces';
import { normalizeAddress } from './guards';

/** The pseudo-address an action's authorization is written under: the low 20 bytes of its slot hash, checksummed. */
export function kitSlot(action: Address): Address {
  const actionAddress = normalizeAddress(action, 'action');
  const slotHash = keccak256(encodeAbiParameters(FORMATS_KIT_SLOT_PREIMAGE_ABI, [FORMATS_KIT_SLOT_TAG, actionAddress]));

  return getAddress(slice(slotHash, size(slotHash) - FORMATS_ADDRESS_BYTES));
}

/** The value the account stores under an action's kit slot, binding the action with empty validator data. */
export function kitBinding(action: Address): Hex {
  const actionAddress = normalizeAddress(action, 'action');

  return keccak256(encodeAbiParameters(FORMATS_KIT_BINDING_PREIMAGE_ABI, [actionAddress, FORMATS_KIT_BINDING_DATA]));
}
