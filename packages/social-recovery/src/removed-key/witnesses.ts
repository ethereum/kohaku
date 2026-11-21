import { hexToBigInt } from 'viem';
import { FORMATS_HEX_BYTES32_PATTERN } from '../constants';
import { normalizeAddress, sameAddress } from '../formats/guards';
import { byPosition } from '../formats/notifications';
import type { Address, KitNotification, PinnedBlock, RemovedKey } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyPrivilegeWrite, RemovedKeyReading } from '../types/removed-key';
import { confirm } from './steps';

/** The answer with no candidate beside it. */
export const alone = (key: RemovedKey): RemovedKeyReading => ({ key, candidates: [] });

/** The checksummed address, or `undefined` where the value is none. */
function addressOf(value: unknown): Address | undefined {
  try {
    return normalizeAddress(value, 'address');
  } catch {
    return undefined;
  }
}

/** Whether the write leaves a nonzero 32-byte privilege; a malformed value leaves none the inference can read. */
function grants(write: RemovedKeyPrivilegeWrite): boolean {
  const priv: unknown = write.priv;

  return typeof priv === 'string' && FORMATS_HEX_BYTES32_PATTERN.test(priv) && hexToBigInt(write.priv) !== 0n;
}

/**
 * Each address whose last privilege write on the bound account is nonzero, in the order of those last writes: a log in a
 * replaced block is dropped, of two writes at one position the later arrival counts, and a write naming no address is skipped.
 */
function privilegeHolders(notifications: readonly KitNotification[], inputs: CheckedRemovedKeyInputs): Address[] {
  const writes = notifications.filter(
    (entry): entry is RemovedKeyPrivilegeWrite => entry.kind === 'privilege-changed' && !entry.at.removed,
  );
  const last = new Map<Address, RemovedKeyPrivilegeWrite>();

  for (const write of writes.sort(byPosition)) {
    const account = addressOf(write.account);
    const addr = addressOf(write.addr);

    if (account !== undefined && addr !== undefined && sameAddress(account, inputs.account)) last.set(addr, write);
  }

  const held = [...last].filter(([, write]) => grants(write)).sort(([, left], [, right]) => byPosition(left, right));

  return held.map(([addr]) => addr);
}

/** The addresses read beside the named key: the setup commit's signer where one was recovered, then the privilege holders. */
export function witnessesOf(
  signer: Address | 'unread' | undefined,
  privileges: readonly KitNotification[] | 'unread',
  inputs: CheckedRemovedKeyInputs,
): Address[] {
  const signers = signer === undefined || signer === 'unread' ? [] : [signer];
  const holders = privileges === 'unread' ? [] : privilegeHolders(privileges, inputs);

  return [...signers, ...holders];
}

/**
 * `key` alone where `isAuthority` confirms no other witness at `block`, else `ambiguous` with every confirmed address, `key`
 * first and then the witnesses in their order, each once; a witness whose read fails or answers no boolean is not confirmed.
 */
export async function confirmedReading(
  key: Address,
  witnesses: readonly Address[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyReading> {
  const others = [...new Set(witnesses)].filter((witness) => !sameAddress(witness, key));
  const answers = await Promise.all(others.map((witness) => confirm(witness, inputs, block)));
  const live = answers.filter((answer): answer is Address => answer !== 'denied' && answer !== 'unread');

  return live.length === 0 ? alone(key) : { key: 'ambiguous', candidates: [key, ...live] };
}
