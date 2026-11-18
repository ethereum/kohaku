import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { entrypointInfoSelector } from './slices.selectors';

const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** The head the last sync scanned up to. */
export const selectLastSyncedBlock = createSelector(
  [
    entrypointInfoSelector,
    (state: RootState) => BigInt(state.sync.lastSyncedBlock),
  ],
  ({ deploymentBlock }, lastSyncedBlock): bigint => max(lastSyncedBlock, deploymentBlock),
);

/**
 * Where the next sync starts: the last block seen finalized. Not the head, nor
 * the latest stored event, which a reorg may have taken off the chain.
 */
export const selectSyncCursor = createSelector(
  [
    entrypointInfoSelector,
    (state: RootState) => BigInt(state.sync.finalizedBlock ?? state.sync.lastSyncedBlock),
  ],
  ({ deploymentBlock }, finalizedBlock): bigint => max(finalizedBlock, deploymentBlock),
);
