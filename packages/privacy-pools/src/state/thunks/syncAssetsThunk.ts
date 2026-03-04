import { createAsyncThunk } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { IAsset } from '../../data/interfaces/events.interface';
import { registerAssets } from '../slices/assetsSlice';
import { RootState } from '../store';

export interface SyncAssetsThunkParams {
  dataService: IDataService;
  myUnsyncedAssetsSelector: () => bigint[];
}

export const syncAssetsThunk = createAsyncThunk<void, SyncAssetsThunkParams, { state: RootState }>(
  'sync/assets',
  async ({ dataService, myUnsyncedAssetsSelector }, { dispatch }) => {
    const myUnsyncedAssets = myUnsyncedAssetsSelector();

    // Fetch asset data for each unsynced asset in parallel
    const assets: IAsset[] = await Promise.all(
      myUnsyncedAssets.map(
        async (assetAddress) => dataService.getAsset(BigInt(assetAddress))
      )
    );

    // Register all assets at once
    if (assets.length > 0) {
      dispatch(registerAssets(assets));
    }
  }
);
