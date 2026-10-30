import { zeroAddress } from 'viem';
import { normalizeAddress } from '../formats/guards';
import type { Findings, HandoverReads } from '../types/validation';
import { addError } from './common';

/** The handover's findings, the ones the action would revert on at the spend, judged from the record and the reads. */
export function handoverFindings(reads: HandoverReads, findings: Findings): void {
  const newAuthority = normalizeAddress(reads.handover.newAuthority, 'context.handover.handover.newAuthority');
  const removed = reads.handover.removedAuthority;
  const removedAuthority = removed === undefined ? undefined : normalizeAddress(removed, 'context.handover.handover.removedAuthority');
  const zeroNew = newAuthority === zeroAddress;
  const zeroRemoved = removedAuthority === zeroAddress;

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
}
