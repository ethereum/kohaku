import { createSelector } from "@reduxjs/toolkit";
import { aspSelector, lastUpdateRootEventSelector } from "./slices.selectors";

export const isAspRootUpToDateSelector = createSelector(
  [
    aspSelector,
    lastUpdateRootEventSelector,
  ],
  (asp, lastUpdateRootEvent): boolean => {
    if (!lastUpdateRootEvent) {
      return false;
    }

    return asp.aspTreeRoot === lastUpdateRootEvent.root &&
           asp.blockNumber === lastUpdateRootEvent.blockNumber;
  }
);

export const aspLeavesSelector = createSelector(
  [aspSelector],
  ({leaves}) => new Set(leaves)
);
