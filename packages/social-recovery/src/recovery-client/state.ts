import { lowerHex } from '../formats/guards';
import type { ActionState, Address, Attempt, BlockHeader, PinnedBlock, RecoveryState, RemovedKey } from '../interfaces';
import { inferRemovedKey } from '../removed-key';
import type { RemovedKeyInputs } from '../types';
import type { RecoveryClientParts } from '../types/recovery-client';

/** What the inference reads for the client's account and action, naming the supplied key as the only candidate where one is given. */
export function inferenceInputs(parts: RecoveryClientParts, supplied?: Address): RemovedKeyInputs {
  return {
    events: parts.events,
    action: parts.recoveryAction,
    codec: parts.codec,
    provider: parts.provider,
    signerRecovery: parts.signerRecovery,
    supplied,
    descriptor: parts.descriptor,
    account: parts.account,
    actionAddress: parts.action,
  };
}

/** The key a handover would remove, inferred at the block with no supplied address; a failed read inside answers `unread`. */
export async function removedKeyAt(parts: RecoveryClientParts, block: PinnedBlock): Promise<RemovedKey> {
  const inputs = inferenceInputs(parts);

  return await inferRemovedKey(inputs, block);
}

/** The recovery-side record of the manager's state with its checked attempt, the inferred removed key and the block all were read at. */
export function recoveryRecord(state: ActionState, attempt: Attempt, removedKey: RemovedKey, header: BlockHeader): RecoveryState {
  return {
    attempt,
    nextAttemptId: state.nextAttemptId,
    setupCommitment: lowerHex(state.setupCommitment),
    setupNonce: state.setupNonce,
    removedKey,
    block: header,
  };
}
