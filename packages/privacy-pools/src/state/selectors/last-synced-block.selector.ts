import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { depositsSelector, entrypointInfoSelector, ragequitsSelector, withdrawalsSelector } from './slices.selectors';

export const selectLastSyncedBlock = createSelector(
  [
    depositsSelector,
    withdrawalsSelector,
    ragequitsSelector,
    entrypointInfoSelector,
    (state: RootState) => BigInt(state.sync.lastSyncedBlock),
  ],
  (depositsMap, withdrawalsMap, ragequitsMap, { deploymentBlock }, lastSyncedBlock): bigint => {
    let maxBlock = 0n;

    for (const deposit of depositsMap.values()) {
      if (deposit.blockNumber > maxBlock) {
        maxBlock = deposit.blockNumber;
      }
    }

    for (const withdrawal of withdrawalsMap.values()) {
      if (withdrawal.blockNumber > maxBlock) {
        maxBlock = withdrawal.blockNumber;
      }
    }

    for (const ragequit of ragequitsMap.values()) {
      if (ragequit.blockNumber > maxBlock) {
        maxBlock = ragequit.blockNumber;
      }
    }

    if (lastSyncedBlock > maxBlock) {
      maxBlock = lastSyncedBlock;
    }

    if (deploymentBlock > maxBlock) {
      maxBlock = deploymentBlock;
    }

    return maxBlock;
  }
);
