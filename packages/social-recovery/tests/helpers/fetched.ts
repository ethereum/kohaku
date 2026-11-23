import type { FetchedNotifications, KitNotification, LogPosition, SkippedLog } from '../../src/index';

/** A skipped entry for a manager log at the position, carrying the value its decoder threw. */
export const skippedAt = (at: LogPosition, error: unknown): SkippedLog => ({
  at,
  log: {
    address: `0x${'a1'.repeat(20)}`,
    topics: [`0x${'ee'.repeat(32)}`],
    data: '0x01',
    blockNumber: at.blockNumber,
    blockHash: at.blockHash,
    logIndex: at.logIndex,
    transactionHash: at.transactionHash,
  },
  error,
});

/** Shapes a fetch answer that lists the given skipped entries beside the notifications. */
export const withSkipped =
  (...skipped: readonly SkippedLog[]) =>
  (notifications: readonly KitNotification[]): FetchedNotifications => ({ notifications, skipped });

/** Shapes a fetch answer as the bare notification array an `IEventManager` written for the old `fetch` returns. */
export const bareArray = (notifications: readonly KitNotification[]): unknown => notifications;
