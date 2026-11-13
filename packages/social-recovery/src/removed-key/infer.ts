import type { Address, KitNotification, PinnedBlock, RemovedKey } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyInputs, RemovedKeyReading } from '../types/removed-key';
import { checkedBlock } from '../formats/guards';
import { decodedOnly } from '../formats/notifications';
import { checkedInputs } from './check';
import { isWellFormedAnswer } from './select';
import { confirm, fromHandover, fromSetupSigner, setupSigner } from './steps';
import { alone, confirmedReading, witnessesOf } from './witnesses';

/** The bound notifications the filter selects from the deployment block to the pinned one; `unread` where the read fails or skips a log. */
async function readNotifications(
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
  filter: 'accountFilter' | 'privilegeFilter',
): Promise<readonly KitNotification[] | 'unread'> {
  if (inputs.descriptor.deployedAt > block.number) return [];

  try {
    const read: unknown = await inputs.events.fetch(inputs.events[filter](), {
      from: inputs.descriptor.deployedAt,
      to: block.number,
    });
    const notifications = decodedOnly(read);

    return isWellFormedAnswer(notifications) ? notifications : 'unread';
  } catch {
    return 'unread';
  }
}

/** The key the walk named, read against every other address the inference can name; the setup signer only where `readSigner`. */
async function witnessed(
  key: Address,
  readSigner: boolean,
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyReading> {
  const [signer, privileges] = await Promise.all([
    readSigner ? setupSigner(notifications, inputs) : undefined,
    readNotifications(inputs, block, 'privilegeFilter'),
  ]);
  const witnesses = witnessesOf(signer, privileges, inputs);

  return await confirmedReading(key, witnesses, inputs, block);
}

/** What `inferRemovedKey` answers, with every address `isAuthority` confirmed where the answer is `ambiguous`, the named key first. */
export async function removedKeyReading(inputs: RemovedKeyInputs, block: PinnedBlock): Promise<RemovedKeyReading> {
  const checked = checkedInputs(inputs);
  const pinned = checkedBlock(block, 'block');

  if (checked.supplied !== undefined) {
    const answer = await confirm(checked.supplied, checked, pinned);

    return alone(answer === 'denied' ? 'not-a-key' : answer);
  }

  const notifications = await readNotifications(checked, pinned, 'accountFilter');

  if (notifications === 'unread') return alone('unread');

  let denied = false;

  for (const step of [fromHandover, fromSetupSigner]) {
    const answer = await step(notifications, checked, pinned);

    if (answer === 'denied') denied = true;
    else if (answer === 'unread') return alone(answer);
    else if (answer !== undefined) return await witnessed(answer, step === fromHandover, notifications, checked, pinned);
  }

  return alone(denied ? 'not-a-key' : 'no-source');
}

/**
 * The key a handover removes for the bound account, each candidate counting only once `isAuthority` confirms it at `block`:
 * a supplied address alone, else the latest consumed handover's new key, else the signer of the latest setup commit.
 * A key named without a supplied address is then read against every other address the inference can name: the setup
 * commit's signer where the handover named the key, and each address whose last privilege write on the account since the
 * deployment block is nonzero. Where `isAuthority` confirms any of them at `block` the answer is `ambiguous`; one whose read
 * fails or answers malformed is not confirmed and leaves the key named.
 * Throws a `TypeError` or `RangeError` on malformed inputs before any read. A supplied key's rejected `isAuthority` rejects as itself;
 * any other read that fails before a key is named resolves to `unread`, and nothing after it is read.
 */
export async function inferRemovedKey(inputs: RemovedKeyInputs, block: PinnedBlock): Promise<RemovedKey> {
  const reading = await removedKeyReading(inputs, block);

  return reading.key;
}
