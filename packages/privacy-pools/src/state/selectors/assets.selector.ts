import { createSelector } from "@reduxjs/toolkit";

import { createMyPoolsSelector } from "./pools.selector";
import { assetSelector } from "./slices.selectors";

export const createAreAssetsSyncedSelector = (
  myPoolsSelector: ReturnType<typeof createMyPoolsSelector>
) => {
  return createSelector(
    [
      myPoolsSelector,
      assetSelector,
    ],
    (myPools, assets): boolean => {
      const uniqueAssetAddresses = new Set(
        myPools.map(({ asset }) => asset)
      );

      return uniqueAssetAddresses.size === assets.size;
    }
  );
};

export const createMyUnsyncedAssetsSelector = (
  myPoolsSelector: ReturnType<typeof createMyPoolsSelector>
) => {
  return createSelector(
    [
      myPoolsSelector,
      assetSelector,
    ],
    (myPools, assets): bigint[] => {
      const uniqueAssetAddresses = new Set(
        myPools.map(({ asset }) => asset)
      );

      return Array.from(uniqueAssetAddresses).filter(
        (address) => !assets.has(address)
      );
    }
  );
};
