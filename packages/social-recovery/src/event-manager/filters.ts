import { pad } from 'viem';
import {
  EVENT_MANAGER_ACCOUNT_EVENTS,
  EVENT_MANAGER_MANAGER_EVENTS,
  EVENT_MANAGER_METHOD_EVENTS,
  EVENT_MANAGER_TOPIC_SIZE,
} from '../constants';
import type { AccountFilterOptions, Address, FilterSpec, Hex } from '../interfaces';

/** An address as the 32-byte topic an indexed address fills. */
export const addressTopic = (address: Address): Hex => pad(address.toLowerCase() as Hex, { size: EVENT_MANAGER_TOPIC_SIZE });

const topicsOf = (events: readonly { readonly topic0: Hex }[]): readonly Hex[] => events.map((entry) => entry.topic0);

/** The manager's events for the account and action; `allActions` leaves the action open. */
export const accountFilterSpec = (
  manager: Address,
  account: Address,
  action: Address,
  options?: AccountFilterOptions,
): FilterSpec => ({
  address: [manager],
  topics: [topicsOf(EVENT_MANAGER_MANAGER_EVENTS), addressTopic(account), options?.allActions === true ? null : addressTopic(action)],
});

/** The method events from the given method addresses, unfiltered by indexed fields. */
export const methodFilterSpec = (methods: readonly Address[]): FilterSpec => ({
  address: methods,
  topics: [topicsOf(EVENT_MANAGER_METHOD_EVENTS)],
});

/** The account's `LogPrivilegeChanged` events. */
export const privilegeFilterSpec = (account: Address): FilterSpec => ({
  address: [account],
  topics: [topicsOf(EVENT_MANAGER_ACCOUNT_EVENTS)],
});
