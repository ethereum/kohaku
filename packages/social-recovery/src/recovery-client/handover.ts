import { RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE } from '../constants';
import { KitRefusalError } from '../client-core';
import { assertBool, isRemovedKeyUnnamed } from '../formats/guards';
import type { Address, Handover, PinnedBlock, RemovedKey } from '../interfaces';
import { inferRemovedKey } from '../removed-key';
import type { RecoveryClientParts, ResolvedRemovedKey } from '../types/recovery-client';
import { addError, emptyFindings } from '../validation/common';
import { handoverFindings } from '../validation/request-handover';
import { inferenceInputs } from './state';

/**
 * The inference's answer read against the supplied key: the key the handover removes, the action's answer for it where one
 * was given, and the cause where no key can be named, which a confirmed key or a supplied key the action denied never has.
 */
function resolvedKey(key: RemovedKey, supplied: Address | undefined): ResolvedRemovedKey {
  if (!isRemovedKeyUnnamed(key)) return { named: key, removedIsAuthority: true, unknown: undefined };

  if (supplied === undefined) return { named: undefined, removedIsAuthority: undefined, unknown: key };

  return key === 'not-a-key'
    ? { named: supplied, removedIsAuthority: false, unknown: undefined }
    : { named: supplied, removedIsAuthority: undefined, unknown: key };
}

/**
 * The handover with the key it removes named: the supplied one once the action confirms it is a key, else the one
 * `inferRemovedKey` names. Refuses with one `KitRefusalError` carrying every handover finding: a zero address, one address
 * on both sides, a removed key that is not a key or cannot be named, and a new key that already holds a privilege.
 * Every read is pinned to `block`. A rejection of the supplied key's `isAuthority` or of `holdsAnyPrivilege` rejects the init
 * with the same value, passed through by the inference; a failure inside the inference's own reads names nothing and becomes the `handover.removed-unknown` finding.
 */
export async function namedHandover(parts: RecoveryClientParts, handover: Handover, block: PinnedBlock): Promise<Required<Handover>> {
  const { newAuthority, removedAuthority: supplied } = handover;
  const inputs = inferenceInputs(parts, supplied);
  const key = await inferRemovedKey(inputs, block);
  const holds: unknown = await parts.recoveryAction.holdsAnyPrivilege(newAuthority, block);

  assertBool(holds, 'holdsAnyPrivilege');

  const { named, removedIsAuthority, unknown } = resolvedKey(key, supplied);
  const findings = emptyFindings();

  handoverFindings(
    {
      handover: named === undefined ? { newAuthority } : { newAuthority, removedAuthority: named },
      layoutDecodes: true,
      removedIsAuthority,
      newHoldsAnyPrivilege: holds,
    },
    findings,
  );

  if (unknown !== undefined) addError(findings, 'handover.removed-unknown', 'request', { account: parts.account, removedKey: unknown });

  if (findings.errors.length > 0 || named === undefined) {
    throw new KitRefusalError(RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE, { findings });
  }

  return { newAuthority, removedAuthority: named };
}
