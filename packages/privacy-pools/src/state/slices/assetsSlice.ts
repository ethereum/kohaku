import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IAsset } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface AssetsState {
  assetsTuples: [Address, IAsset][];
}

type ActualAssetState = Serializable<AssetsState>;

const initialState: ActualAssetState = {
  assetsTuples: [],
};

export const assetsSlice = createSlice({
  name: 'assets',
  initialState,
  reducers: {
    registerAssets: ({ assetsTuples }, { payload: assets }: PayloadAction<IAsset[]>) => {
      const newAssets = new Map(assetsTuples);

      assets.forEach((asset) => {
        const key = asset.address;

        newAssets.set(serialize(key), serialize(asset));
      });

      return { assetsTuples: Array.from(newAssets) };
    },
  },
});

export const { registerAssets } = assetsSlice.actions;
export const assetsReducer = assetsSlice.reducer;
