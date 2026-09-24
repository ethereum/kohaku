import type { AccountFilterOptions, BlockRange, FilterSpec, Notification, RawLog } from './records';

/**
 * The shared part for the logs, bound to one chain, one account and one action
 * (D-201, D-203). `EventManager` is the shipped implementation.
 */
export interface IEventManager {
  /** The manager's five events for the bound account and action; the option opens the action topic. */
  accountFilter(options?: AccountFilterOptions): FilterSpec;
  /** The eight method events over the descriptor's methods and the registered modules. */
  methodFilter(): FilterSpec;
  /** The account's own privilege writes. */
  privilegeFilter(): FilterSpec;
  /** Reads the range in chunks and returns the decoded notifications in log order. */
  fetch(filter: FilterSpec, range: BlockRange): Promise<readonly Notification[]>;
  /** Nothing for a log the reader does not own. */
  decodeLog(log: RawLog): Notification | undefined;
}
