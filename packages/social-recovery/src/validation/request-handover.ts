import { zeroAddress } from 'viem';
import { RECOVERY_ACTION_FALLBACK_HANDLER_SLOT, VALIDATION_RESERVED_DESTINATIONS } from '../constants';
import { normalizeAddress, sameAddress } from '../formats/guards';
import { kitSlot } from '../formats/kit';
import type { Address } from '../interfaces';
import type { Findings, HandoverBinding, HandoverReads, ReservedDestination } from '../types/validation';
import { addError } from './common';

/** Which reserved address the new key is, the first match in `VALIDATION_RESERVED_DESTINATIONS` order. */
export function reservedDestination(newAuthority: Address, binding: HandoverBinding): ReservedDestination | undefined {
  const reserved: Readonly<Record<ReservedDestination, Address>> = {
    account: binding.account,
    manager: binding.manager,
    action: binding.action,
    'kit-slot': kitSlot(binding.action),
    'fallback-handler': RECOVERY_ACTION_FALLBACK_HANDLER_SLOT,
  };

  return VALIDATION_RESERVED_DESTINATIONS.find((destination) => sameAddress(newAuthority, reserved[destination]));
}

/**
 * The handover's findings, the ones the action would revert on at the spend and a new key at an address nobody can sign
 * for, judged from the record, the reads and the account and action the request names.
 */
export function handoverFindings(reads: HandoverReads, pair: Omit<HandoverBinding, 'manager'>, findings: Findings): void {
  const newAuthority = normalizeAddress(reads.handover.newAuthority, 'context.handover.handover.newAuthority');
  const removed = reads.handover.removedAuthority;
  const removedAuthority = removed === undefined ? undefined : normalizeAddress(removed, 'context.handover.handover.removedAuthority');
  const manager = normalizeAddress(reads.manager, 'context.handover.manager');
  const zeroNew = newAuthority === zeroAddress;
  const zeroRemoved = removedAuthority === zeroAddress;
  const reserved = zeroNew ? undefined : reservedDestination(newAuthority, { ...pair, manager });

  if (zeroNew || zeroRemoved || !reads.layoutDecodes) {
    addError(findings, 'handover.malformed', 'request', { zeroNew, zeroRemoved, layoutDecodes: reads.layoutDecodes });
  }

  if (removedAuthority !== undefined && newAuthority === removedAuthority) {
    addError(findings, 'handover.same-authority', 'request', { newAuthority, removedAuthority });
  }

  if (removedAuthority !== undefined && reads.removedIsAuthority === false) {
    addError(findings, 'handover.removed-not-authority', 'request', { removedAuthority, isAuthority: false });
  }

  if (reads.newHoldsAnyPrivilege) {
    addError(findings, 'handover.new-holds-privilege', 'request', { newAuthority, holdsAnyPrivilege: true });
  }

  if (reserved !== undefined) {
    addError(findings, 'handover.new-reserved', 'request', { newAuthority, reserved });
  }
}
