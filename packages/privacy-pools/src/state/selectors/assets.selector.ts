import { createSelector } from "@reduxjs/toolkit";

import { createMyPoolsSelector } from "./pools.selector";
import { assetSelector, poolsSelector } from "./slices.selectors";

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

export const unsyncedAssetsSelector = createSelector(
    [
      poolsSelector,
      assetSelector,
    ],
    (pools, assets): bigint[] => {
      const uniqueAssetAddresses = new Set(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        Array.from(pools).map(([_, { asset }]) => asset)
      );

      return Array.from(uniqueAssetAddresses).filter(
        (address) => !assets.has(address)
      );
    }
  );
