import { assertArray, assertBool, assertBytes32, assertObject, isSafeCount, normalizeAddress, sameAddress } from '../formats/guards';
import { assertNotification, byPosition } from '../formats/notifications';
import type {
  KitNotification,
  MethodStopNotification,
  RecoveryState,
  SetupState,
  StatusAttempt,
  StatusDescription,
} from '../interfaces';
import type { OpeningNotification, StatusScope } from '../types/description';

/** The last of the notifications in chain order, leaving out any log the chain removed. */
function latestOf<Notification extends KitNotification>(notifications: readonly Notification[]): Notification | undefined {
  return notifications.filter((notification) => !notification.at.removed).sort(byPosition).at(-1);
}

const isStop = (notification: KitNotification): notification is MethodStopNotification =>
  notification.kind === 'method-paused' || notification.kind === 'method-unpaused';

const isOpening = (notification: KitNotification): notification is OpeningNotification =>
  notification.kind === 'attempt-started';

/** The block both records were read at, or the two hashes where they differ. */
function blockOf(setupState: SetupState, recoveryState: RecoveryState): StatusDescription['block'] {
  const setupHash = setupState.block.hash;
  const recoveryHash = recoveryState.block.hash;

  if (setupHash.toLowerCase() === recoveryHash.toLowerCase()) return { sameBlock: true, hash: setupHash };

  return { sameBlock: false, setupHash, recoveryHash };
}

/** The attempt beside its own latest opening event, of the same id, account and action, absent where the manager holds none. */
function attemptOf(recoveryState: RecoveryState, latest: readonly KitNotification[], scope: StatusScope): StatusAttempt | undefined {
  const { attempt } = recoveryState;

  if (attempt.state === 'None') return undefined;

  const opening = latestOf(
    latest
      .filter(isOpening)
      .filter(
        (event) =>
          event.attemptId === attempt.attemptId && sameAddress(event.account, scope.account) && sameAddress(event.action, scope.action),
      ),
  );

  return {
    state: attempt.state,
    attemptId: attempt.attemptId,
    consumableAfter: attempt.consumableAfter,
    blockTimestamp: recoveryState.block.timestamp,
    usedMethods: [...attempt.usedMethods],
    ...(opening === undefined ? {} : { usedPlaces: [...opening.usedPlaces] }),
    ignoresPause: attempt.ignoresPause,
    ...(opening === undefined ? {} : { payload: opening.payload }),
    order: { ...attempt.order },
  };
}

/** Refuses anything but a non-negative safe integer with a `TypeError`. */
function assertCount(value: unknown, name: string): void {
  if (!isSafeCount(value)) throw new TypeError(`${name} must be a non-negative safe integer`);
}

/** Refuses records and notifications whose members this description reads are not the shapes they declare. */
function assertStatusInputs(setupState: SetupState, recoveryState: RecoveryState, latest: readonly KitNotification[]): void {
  assertObject(setupState, 'setupState');
  assertBool(setupState.isAuthorized, 'setupState.isAuthorized');
  assertBytes32(setupState.setupCommitment, 'setupState.setupCommitment');

  if (typeof setupState.setupNonce !== 'bigint') throw new TypeError('setupState.setupNonce must be a bigint');

  assertCount(setupState.setupCommittedAtBlock, 'setupState.setupCommittedAtBlock');
  assertObject(setupState.block, 'setupState.block');
  assertBytes32(setupState.block.hash, 'setupState.block.hash');
  assertObject(recoveryState, 'recoveryState');
  assertObject(recoveryState.block, 'recoveryState.block');
  assertBytes32(recoveryState.block.hash, 'recoveryState.block.hash');
  assertCount(recoveryState.block.timestamp, 'recoveryState.block.timestamp');
  assertObject(recoveryState.attempt, 'recoveryState.attempt');
  assertArray(latest, 'latest');

  for (let index = 0; index < latest.length; index += 1) assertNotification(latest[index], `latest[${index}]`);
}

/**
 * What a holder's status screen reads, composed from the two state records and the latest notifications with no read.
 * Only an opening event of the scope's account and action describes the attempt.
 * Throws a TypeError where a record or notification member it reads is malformed, or a scope address is.
 */
export function describeStatus(
  setupState: SetupState,
  recoveryState: RecoveryState,
  latest: readonly KitNotification[],
  scope: StatusScope,
): StatusDescription {
  assertStatusInputs(setupState, recoveryState, latest);
  assertObject(scope, 'scope');

  const scoped: StatusScope = {
    account: normalizeAddress(scope.account, 'scope.account'),
    action: normalizeAddress(scope.action, 'scope.action'),
  };
  const attempt = attemptOf(recoveryState, latest, scoped);
  const stops = latest.filter(isStop);

  return {
    block: blockOf(setupState, recoveryState),
    ...(attempt === undefined ? {} : { attempt }),
    armed: setupState.isAuthorized,
    setup: {
      setupCommitment: setupState.setupCommitment,
      setupNonce: setupState.setupNonce,
      setupCommittedAtBlock: setupState.setupCommittedAtBlock,
    },
    stops: (attempt?.usedMethods ?? []).map((method) => {
      const stop = latestOf(stops.filter((notification) => sameAddress(notification.method, method)));

      return stop === undefined ? { method } : { method, latest: stop };
    }),
  };
}
