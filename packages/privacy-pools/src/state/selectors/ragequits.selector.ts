import { createSelector } from '@reduxjs/toolkit';

import { IRagequitEvent } from '../../data/interfaces/events.interface';
import { Precommitment } from '../../interfaces/types.interface';
import { myDepositsSelector } from './deposits.selector';
import { ragequitsSelector } from './slices.selectors';

export const myRagequitsSelector = createSelector(
  [myDepositsSelector, ragequitsSelector],
  (myDeposits, ragequitsMap): Map<Precommitment, IRagequitEvent> => {
    return Array.from(myDeposits.values())
      .reduce((ragequitsByPrecommitment, deposit) => {
        const ragequit = ragequitsMap.get(deposit.label);

        if (ragequit) {
          ragequitsByPrecommitment.set(deposit.precommitment, ragequit);
        }

        return ragequitsByPrecommitment;
      }, new Map<Precommitment, IRagequitEvent>());
  },
);
