import { sameAddress } from '../formats/guards';
import { assertNotification, byPosition } from '../formats/notifications';
import type { KitNotification, LogPosition } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyNotification } from '../types/removed-key';

/** Whether a log read's answer is a dense array of well-formed notifications; a hole or a malformed entry counts against it. */
export function isWellFormedAnswer(answer: unknown): answer is readonly KitNotification[] {
  if (!Array.isArray(answer)) return false;

  try {
    for (let index = 0; index < answer.length; index += 1) {
      if (!(index in answer)) return false;

      assertNotification(answer[index], `notifications[${index}]`);
    }
  } catch {
    return false;
  }

  return true;
}

/** The bound account's and action's notifications of one kind, a log in a replaced block dropped. */
export function ofKind<K extends RemovedKeyNotification['kind']>(
  notifications: readonly KitNotification[],
  kind: K,
  inputs: CheckedRemovedKeyInputs,
): Extract<KitNotification, { readonly kind: K }>[] {
  return notifications.filter(
    (entry): entry is Extract<KitNotification, { readonly kind: K }> =>
      entry.kind === kind &&
      !entry.at.removed &&
      sameAddress(entry.account, inputs.account) &&
      sameAddress(entry.action, inputs.actionAddress),
  );
}

/** The notification sitting last in log order, if any; of two at one position the later arrival. */
export function lastByPosition<N extends { readonly at: LogPosition }>(entries: readonly N[]): N | undefined {
  return [...entries].sort(byPosition).at(-1);
}

/** The start of the highest-id consumed attempt that has one, the latest start by log order where an id repeats. */
export function latestConsumedStart(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
): Extract<KitNotification, { readonly kind: 'attempt-started' }> | undefined {
  const starts = ofKind(notifications, 'attempt-started', inputs);
  const startedIds = new Set(starts.map((start) => start.attemptId));
  let highest: bigint | undefined;

  for (const consumed of ofKind(notifications, 'attempt-consumed', inputs)) {
    if (startedIds.has(consumed.attemptId) && (highest === undefined || consumed.attemptId > highest)) highest = consumed.attemptId;
  }

  if (highest === undefined) return undefined;

  return lastByPosition(starts.filter((start) => start.attemptId === highest));
}
