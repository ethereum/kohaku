import { decodeEventLog } from 'viem';
import { EVENT_MANAGER_ACCOUNT_EVENTS, ACCOUNT_EVENTS_ABI, EVENT_MANAGER_METHOD_EVENTS, METHOD_EVENTS_ABI } from '../constants';
import type { KitNotification, RawLog } from '../interfaces';
import { byTopic0 } from './by-topic0';
import { checksummed, positionOf, topicsFor } from './position';

/** One method log as its notification, its emitter taken as the method, or nothing for any other event. */
export const decodeMethodLog = (log: RawLog): KitNotification | undefined => {
  const owned = byTopic0(EVENT_MANAGER_METHOD_EVENTS, log.topics[0]);

  if (owned === undefined) return undefined;

  const decoded = decodeEventLog({
    abi: METHOD_EVENTS_ABI,
    topics: topicsFor(owned.event, log),
    data: log.data,
    strict: true,
  });
  const method = checksummed(log.address);
  const at = positionOf(log);

  const { eventName } = decoded;

  switch (eventName) {
    case 'Paused':
      return { kind: 'method-paused', method, by: checksummed(decoded.args.account), at };
    case 'Unpaused':
      return { kind: 'method-unpaused', method, by: checksummed(decoded.args.account), at };
    case 'TrustedKeysUpdated':
      return {
        kind: 'method-keys-updated',
        method,
        previous: [...decoded.args.previous],
        current: [...decoded.args.current],
        at,
      };
    case 'AdminRenounced':
      return { kind: 'method-admin-renounced', method, previous: checksummed(decoded.args.previous), at };
    case 'AdminTransferOffered':
      return {
        kind: 'method-admin-transfer-offered',
        method,
        current: checksummed(decoded.args.current),
        pending: checksummed(decoded.args.pending),
        at,
      };
    case 'AdminTransferred':
      return {
        kind: 'method-admin-transferred',
        method,
        previous: checksummed(decoded.args.previous),
        current: checksummed(decoded.args.current),
        at,
      };
    case 'OwnershipTransferStarted':
      return {
        kind: 'method-pause-holder-transfer-started',
        method,
        previous: checksummed(decoded.args.previousOwner),
        pending: checksummed(decoded.args.newOwner),
        at,
      };
    case 'OwnershipTransferred':
      return {
        kind: 'method-pause-holder-transferred',
        method,
        previous: checksummed(decoded.args.previousOwner),
        current: checksummed(decoded.args.newOwner),
        at,
      };
    default: {
      const unhandled: never = eventName;

      throw new TypeError(`The method event ${String(unhandled)} has no decoder.`);
    }
  }
};

/** One account log as its `privilege-changed` notification, or nothing for any other account event. */
export const decodeAccountLog = (log: RawLog): KitNotification | undefined => {
  const owned = byTopic0(EVENT_MANAGER_ACCOUNT_EVENTS, log.topics[0]);

  if (owned === undefined) return undefined;

  const decoded = decodeEventLog({
    abi: ACCOUNT_EVENTS_ABI,
    topics: topicsFor(owned.event, log),
    data: log.data,
    strict: true,
  });

  return {
    kind: 'privilege-changed',
    account: checksummed(log.address),
    addr: checksummed(decoded.args.addr),
    priv: decoded.args.priv,
    at: positionOf(log),
  };
};
