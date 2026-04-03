import { createSelector } from "@reduxjs/toolkit";

import { assetSelector, poolsSelector } from "./slices.selectors";

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
