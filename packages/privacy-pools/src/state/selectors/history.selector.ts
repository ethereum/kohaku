import { createSelector } from '@reduxjs/toolkit';

import { PPv1HistoryEvent } from '../../plugin/interfaces/protocol-params.interface';
import { HistoryEventMetadata } from '../slices/historyMetadataSlice';
import { myDepositsSelector } from './deposits.selector';
import { myRagequitsSelector } from './ragequits.selector';
import { historyMetadataSelector, poolsSelector } from './slices.selectors';
import { myWithdrawalsSelector } from './withdrawals.selector';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * A history event before its on-demand metadata is attached. `eventId` is the key
 * into the history metadata slice.
 */
export type HistoryEventWithoutMetadata = DistributiveOmit<PPv1HistoryEvent, keyof HistoryEventMetadata> & {
  eventId: bigint;
};

/**
 * Every deposit, withdrawal and ragequit of the account, in no particular order.
 */
export const myHistoryEventsSelector = createSelector(
  [myDepositsSelector, myWithdrawalsSelector, myRagequitsSelector, poolsSelector],
  (myDeposits, myWithdrawals, myRagequits, poolsMap): HistoryEventWithoutMetadata[] => {
    const assetOf = (poolAddress: bigint) => poolsMap.get(poolAddress)?.asset;
    const events: HistoryEventWithoutMetadata[] = [];

    for (const deposit of myDeposits.values()) {
      const assetAddress = assetOf(deposit.pool);

      if (assetAddress === undefined) continue;

      events.push({
        type: 'deposit',
        eventId: deposit.precommitment,
        blockNumber: deposit.blockNumber,
        poolAddress: deposit.pool,
        assetAddress,
        value: deposit.value,
        depositor: deposit.depositor,
        label: deposit.label,
        aspStatus: deposit.approved ? 'approved' : 'pending',
      });
    }

    for (const withdrawal of Array.from(myWithdrawals.values()).flat()) {
      const assetAddress = assetOf(withdrawal.pool);

      if (assetAddress === undefined) continue;

      events.push({
        type: 'withdrawal',
        eventId: withdrawal.spentNullifier,
        blockNumber: withdrawal.blockNumber,
        poolAddress: withdrawal.pool,
        assetAddress,
        value: withdrawal.value,
      });
    }

    for (const ragequit of myRagequits.values()) {
      const assetAddress = assetOf(ragequit.pool);

      if (assetAddress === undefined) continue;

      events.push({
        type: 'ragequit',
        eventId: ragequit.label,
        blockNumber: ragequit.blockNumber,
        poolAddress: ragequit.pool,
        assetAddress,
        value: ragequit.value,
        ragequitter: ragequit.ragequitter,
      });
    }

    return events;
  },
);

/**
 * Events still missing their transaction hash, log index or timestamp.
 */
export const myHistoryEventsWithoutMetadataSelector = createSelector(
  [myHistoryEventsSelector, historyMetadataSelector],
  (events, metadataMap): HistoryEventWithoutMetadata[] =>
    events.filter(({ eventId }) => !metadataMap.has(eventId)),
);

/**
 * The account's history, newest first. Events whose metadata hasn't been
 * fetched yet are left out.
 */
export const myHistorySelector = createSelector(
  [myHistoryEventsSelector, historyMetadataSelector],
  (events, metadataMap): PPv1HistoryEvent[] =>
    events
      .flatMap(({ eventId, ...event }) => {
        const metadata = metadataMap.get(eventId);

        return metadata ? [{ ...event, ...metadata } as PPv1HistoryEvent] : [];
      })
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? b.logIndex - a.logIndex
          : b.blockNumber > a.blockNumber ? 1 : -1,
      ),
);
