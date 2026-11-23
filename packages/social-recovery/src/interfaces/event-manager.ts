import type { AccountFilterOptions, BlockRange, FetchedNotifications, FilterSpec, KitNotification, RawLog } from './records';

/** Reads and decodes the logs of one account and one action on one chain. */
export interface IEventManager {
  /** The manager's events for the bound account and action; `allActions` leaves the action topic open. */
  accountFilter(options?: AccountFilterOptions): FilterSpec;
  /** The method modules' events, over the descriptor's methods and the registered modules. */
  methodFilter(): FilterSpec;
  /** The account's own privilege writes. */
  privilegeFilter(): FilterSpec;
  /**
   * Reads the range in chunks and returns the decoded notifications in log order; every owned log whose decoder throws is
   * listed in `skipped` rather than rejecting the read, with its position.
   */
  fetch(filter: FilterSpec, range: BlockRange): Promise<FetchedNotifications>;
  /** `undefined` for a log this reader does not own. */
  decodeLog(log: RawLog): KitNotification | undefined;
}
