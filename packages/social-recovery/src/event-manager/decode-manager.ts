import { decodeEventLog } from 'viem';
import { EVENT_MANAGER_MANAGER_EVENTS, MANAGER_EVENTS_ABI } from '../constants';
import type { KitNotification, RawLog } from '../interfaces';
import { byTopic0 } from './by-topic0';
import { deriveCancelledBy } from './cancelled-by';
import { checksummed, positionOf, topicsFor } from './position';

/** One manager log as its notification, or nothing when its first topic names no manager event. */
export const decodeManagerLog = (log: RawLog): KitNotification | undefined => {
  const owned = byTopic0(EVENT_MANAGER_MANAGER_EVENTS, log.topics[0]);

  if (owned === undefined) return undefined;

  const decoded = decodeEventLog({
    abi: MANAGER_EVENTS_ABI,
    topics: topicsFor(owned.event, log),
    data: log.data,
    strict: true,
  });
  const at = positionOf(log);
  const account = checksummed(decoded.args.account);
  const action = checksummed(decoded.args.action);

  const { eventName } = decoded;

  switch (eventName) {
    case 'SetupCommitted':
      return {
        kind: 'setup-committed',
        account,
        action,
        nonce: decoded.args.nonce,
        setupCommitment: decoded.args.setupCommitment,
        publicMetadata: decoded.args.publicMetadata,
        privateMetadata: decoded.args.privateMetadata,
        at,
      };
    case 'SetupCleared':
      return { kind: 'setup-cleared', account, action, nonce: decoded.args.nonce, at };
    case 'AttemptStarted': {
      const { order } = decoded.args;

      return {
        kind: 'attempt-started',
        account,
        action,
        attemptId: decoded.args.attemptId,
        setupNonce: decoded.args.setupNonce,
        setupBody: decoded.args.setupBody,
        usedPlaces: [...decoded.args.usedPlaces],
        usedMethods: decoded.args.usedMethods.map(checksummed),
        payload: decoded.args.payload,
        order: { token: checksummed(order.token), amount: order.amount, payee: checksummed(order.payee) },
        consumableAfter: decoded.args.consumableAfter,
        at,
      };
    }
    case 'AttemptCancelled': {
      const canceller = checksummed(decoded.args.canceller);
      const vetoingMethod = checksummed(decoded.args.vetoingMethod);
      const usedPlaces = [...decoded.args.usedPlaces];

      return {
        kind: 'attempt-cancelled',
        account,
        action,
        attemptId: decoded.args.attemptId,
        canceller,
        vetoingMethod,
        cancelledBy: deriveCancelledBy({ account, canceller, vetoingMethod, usedPlaces }),
        setupNonce: decoded.args.setupNonce,
        usedPlaces,
        at,
      };
    }
    case 'AttemptConsumed':
      return { kind: 'attempt-consumed', account, action, attemptId: decoded.args.attemptId, at };
    default: {
      const unhandled: never = eventName;

      throw new TypeError(`The manager event ${String(unhandled)} has no decoder.`);
    }
  }
};
