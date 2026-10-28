import { FORMATS_ZERO_ADDRESS } from '../constants';
import { lowerHex, normalizeAddress, sameAddress } from '../formats/guards';
import type { Address, KitNotification, PinnedBlock, RawTransaction } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyStepAnswer } from '../types/removed-key';
import { lastByPosition, latestConsumedStart, ofKind } from './select';

/**
 * The key if `isAuthority` confirms it at the block, `denied` if not, `unread` where the answer is no boolean.
 * A rejected read answers `unread` for a candidate the inference found itself, and rejects as itself for a supplied one.
 */
export async function confirm(key: Address, inputs: CheckedRemovedKeyInputs, block: PinnedBlock): Promise<Exclude<RemovedKeyStepAnswer, undefined>> {
  let answer: unknown;

  try {
    answer = await inputs.action.isAuthority(key, block);
  } catch (thrown) {
    if (inputs.supplied !== undefined) throw thrown;

    return 'unread';
  }

  if (typeof answer !== 'boolean') return 'unread';

  return answer ? key : 'denied';
}

/** The new key of the highest-id consumed attempt, asked of `isAuthority`; nothing where its payload does not decode or names the zero address. */
export async function fromHandover(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyStepAnswer> {
  const start = latestConsumedStart(notifications, inputs);

  if (start === undefined) return undefined;

  let newAuthority: Address;

  try {
    newAuthority = normalizeAddress(inputs.codec.decode(start.payload).newAuthority, 'newAuthority');
  } catch {
    return undefined;
  }

  if (sameAddress(newAuthority, FORMATS_ZERO_ADDRESS)) return undefined;

  return confirm(newAuthority, inputs, block);
}

/** The signer the integrator recovers from the transaction of the latest setup commit, asked of `isAuthority`. */
export async function fromSetupSigner(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyStepAnswer> {
  const { signerRecovery } = inputs;

  if (signerRecovery === undefined) return undefined;

  const commits = ofKind(notifications, 'setup-committed', inputs);
  const commit = lastByPosition(commits);

  if (commit === undefined) return undefined;

  let signer: Address;

  try {
    const transaction: RawTransaction | null | undefined = await inputs.provider.transaction(commit.at.transactionHash);

    if (transaction === undefined || transaction === null) return 'unread';

    if (
      lowerHex(transaction.hash) !== lowerHex(commit.at.transactionHash) ||
      lowerHex(transaction.blockHash) !== lowerHex(commit.at.blockHash)
    ) {
      return 'unread';
    }

    const recovered = await signerRecovery.recoverSigner(transaction, inputs.account);

    if (recovered === undefined) return undefined;

    signer = normalizeAddress(recovered, 'recoverSigner');
  } catch {
    return 'unread';
  }

  return confirm(signer, inputs, block);
}
