import { createAsyncThunk } from '@reduxjs/toolkit';

import { IDataService, IPoolEventsWithLogMeta } from '../../data/interfaces/data.service.interface';
import { HistoryEventWithoutMetadata, myHistoryEventsWithoutMetadataSelector } from '../selectors/history.selector';
import { HistoryEventMetadata, registerHistoryMetadata } from '../slices/historyMetadataSlice';
import { RootState } from '../store';

export interface SyncHistoryMetadataThunkParams {
  dataService: IDataService;
}

// Blocks fetched in parallel, to stay friendly with public RPCs.
const CONCURRENCY = 5;

const findLog = (
  { PoolDeposited, Withdrawn, Ragequit }: IPoolEventsWithLogMeta,
  event: HistoryEventWithoutMetadata,
) => {
  switch (event.type) {
    case 'deposit': return PoolDeposited.find(({ precommitment }) => precommitment === event.eventId);
    case 'withdrawal': return Withdrawn.find(({ spentNullifier }) => spentNullifier === event.eventId);
    case 'ragequit': return Ragequit.find(({ label }) => label === event.eventId);
  }
};

/**
 * Fetches transaction hash, log index and timestamp for the account's history
 * events that don't have them yet. Only the user's own events are looked up:
 * one `eth_getLogs` per (pool, block) and one block fetch per block.
 */
export const syncHistoryMetadataThunk = createAsyncThunk<void, SyncHistoryMetadataThunkParams, { state: RootState }>(
  'sync/historyMetadata',
  async ({ dataService }, { dispatch, getState }) => {
    const pendingEvents = myHistoryEventsWithoutMetadataSelector(getState());

    if (pendingEvents.length === 0) return;

    const eventsByPoolBlock = new Map<string, HistoryEventWithoutMetadata[]>();

    for (const event of pendingEvents) {
      const key = `${event.poolAddress}-${event.blockNumber}`;

      eventsByPoolBlock.set(key, [...(eventsByPoolBlock.get(key) ?? []), event]);
    }

    const timestamps = new Map<bigint, Promise<bigint>>();
    const getTimestamp = (blockNumber: bigint) => {
      let timestamp = timestamps.get(blockNumber);

      if (!timestamp) {
        timestamp = dataService.getBlockTimestamp(blockNumber);
        timestamps.set(blockNumber, timestamp);
      }

      return timestamp;
    };

    const groups = Array.from(eventsByPoolBlock.values());
    const metadata: [bigint, HistoryEventMetadata][] = [];

    for (let start = 0; start < groups.length; start += CONCURRENCY) {
      const results = await Promise.all(groups.slice(start, start + CONCURRENCY).map(async (events) => {
        const [{ poolAddress, blockNumber }] = events as [HistoryEventWithoutMetadata];
        const [logs, timestamp] = await Promise.all([
          dataService.getPoolEventsAtBlock(poolAddress, blockNumber),
          getTimestamp(blockNumber),
        ]);

        return events.map((event): [bigint, HistoryEventMetadata] => {
          const log = findLog(logs, event);

          if (!log) {
            throw new Error(`Couldn't find ${event.type} log in pool ${poolAddress} at block ${blockNumber}`);
          }

          return [event.eventId, { transactionHash: log.transactionHash, logIndex: log.logIndex, timestamp }];
        });
      }));

      metadata.push(...results.flat());
    }

    dispatch(registerHistoryMetadata(metadata));
  },
);
