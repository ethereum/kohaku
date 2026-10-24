import { createSelector } from '@reduxjs/toolkit';

import { PPv1HistoryEvent } from '../../plugin/interfaces/protocol-params.interface';
import { RootState } from '../store';
import { deserialize } from '../utils/serialize.utils';
import { myDepositsSelector } from './deposits.selector';
import { myRagequitsSelector } from './ragequits.selector';
import { historyMetadataSelector, poolsSelector } from './slices.selectors';
import { myWithdrawalsSelector } from './withdrawals.selector';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * A history event before its timestamp is attached. `eventId` is the key into
 * the legacy history metadata.
 */
export type HistoryEventWithoutTimestamp = DistributiveOmit<PPv1HistoryEvent, 'timestamp'> & {
  eventId: bigint;
};

/**
 * Every deposit, withdrawal and ragequit of the account, in no particular order.
 * The transaction hash and log index come from the bulk sync (0n / 0 when its
 * source did not provide them: saga, or a state synced by an older version).
 */
export const myHistoryEventsSelector = createSelector(
  [myDepositsSelector, myWithdrawalsSelector, myRagequitsSelector, poolsSelector],
  (myDeposits, myWithdrawals, myRagequits, poolsMap): HistoryEventWithoutTimestamp[] => {
    const assetOf = (poolAddress: bigint) => poolsMap.get(poolAddress)?.asset;
    const events: HistoryEventWithoutTimestamp[] = [];
    const logMeta = ({ transactionHash, logIndex, blockNumber }: { transactionHash: bigint; logIndex?: number; blockNumber: bigint }) =>
      ({ transactionHash, logIndex: logIndex ?? 0, blockNumber });

    for (const deposit of myDeposits.values()) {
      const assetAddress = assetOf(deposit.pool);

      if (assetAddress === undefined) continue;

      events.push({
        type: 'deposit',
        eventId: deposit.precommitment,
        ...logMeta(deposit),
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
        ...logMeta(withdrawal),
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
        ...logMeta(ragequit),
        poolAddress: ragequit.pool,
        assetAddress,
        value: ragequit.value,
        ragequitter: ragequit.ragequitter,
      });
    }

    return events;
  },
);

/** [blockNumber, timestamp] anchors, sorted by block. */
export const timestampAnchorsSelector = createSelector(
  [(state: RootState) => state.historyMetadata.timestampAnchors],
  (anchors = []): [bigint, bigint][] =>
    (deserialize(anchors) as [bigint, bigint][]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

/**
 * Linear interpolation between the anchors around `blockNumber`, or undefined
 * outside them. Post-merge a block is at least one 12 s slot after its parent,
 * so the estimate always lies between the anchors' own bounds.
 */
export const interpolateTimestamp = (anchors: [bigint, bigint][], blockNumber: bigint): bigint | undefined => {
  let low = 0;
  let high = anchors.length - 1;

  if (high < 0 || blockNumber < anchors[0]![0] || blockNumber > anchors[high]![0]) return undefined;

  // Narrow to the cell [anchors[low], anchors[high]] that holds the block.
  while (high - low > 1) {
    const mid = (low + high) >> 1;

    if (anchors[mid]![0] <= blockNumber) low = mid;
    else high = mid;
  }

  const [fromBlock, fromTime] = anchors[low]!;
  const [toBlock, toTime] = anchors[high]!;

  if (toBlock === fromBlock) return fromTime;

  return fromTime + ((toTime - fromTime) * (blockNumber - fromBlock)) / (toBlock - fromBlock);
};

/**
 * The account's history, newest first. Timestamps are interpolated from the
 * anchors; exact metadata fetched by older versions wins where present. Events
 * the anchors don't cover yet are left out.
 */
export const myHistorySelector = createSelector(
  [myHistoryEventsSelector, historyMetadataSelector, timestampAnchorsSelector],
  (events, metadataMap, anchors): PPv1HistoryEvent[] =>
    events
      .flatMap(({ eventId, ...event }) => {
        const metadata = metadataMap.get(eventId);
        const timestamp = metadata?.timestamp ?? interpolateTimestamp(anchors, event.blockNumber);

        return timestamp === undefined ? [] : [{ ...event, timestamp, ...metadata } as PPv1HistoryEvent];
      })
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? b.logIndex - a.logIndex
          : b.blockNumber > a.blockNumber ? 1 : -1,
      ),
);
