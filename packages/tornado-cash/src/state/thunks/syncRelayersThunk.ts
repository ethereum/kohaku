import { createAsyncThunk } from '@reduxjs/toolkit';
import { namehash } from 'viem/ens';

import { IDataService } from '../../data/interfaces/data.service.interface';
import { RootState } from '../store';
import { instanceRegistryInfoSelector } from '../selectors/slices.selectors';
import { IRelayerInfo, registerRelayers } from '../slices/relayersSlice';

export interface SyncRelayersThunkParams {
  dataService: IDataService;
}

const MIN_STAKE_BALANCE = 40n * 10n ** 18n;
const MAINNET_SUBDOMAIN = 'mainnet-tornado';

export const syncRelayersThunk = createAsyncThunk<void, SyncRelayersThunkParams, { state: RootState }>(
  'sync/relayers',
  async ({ dataService }, { dispatch, getState }) => {
    const state = getState();
    const {
      relayerRegistryAddress,
      relayerRegistryDeploymentBlock,
      aggregatorAddress,
      ensSubdomainKey,
    } = instanceRegistryInfoSelector(state);

    const { RelayerRegistered: events } = await dataService.getRelayerRegistryEvents({
      events: 'RelayerRegistered',
      address: relayerRegistryAddress,
      fromBlock: relayerRegistryDeploymentBlock,
    });

    if (events.length === 0) {
      return;
    }

    const hashes = events.map((e) => BigInt(namehash(e.ensName)));

    // Always include mainnet subdomain first (index 0), then current network (index 1)
    const subdomains = ensSubdomainKey === MAINNET_SUBDOMAIN
      ? [MAINNET_SUBDOMAIN]
      : [MAINNET_SUBDOMAIN, ensSubdomainKey];

    const aggregatorData = await dataService.getRelayerData(
      aggregatorAddress,
      hashes,
      subdomains,
    );

    // subdomainIndex: if mainnet, hostname is at records[0]; otherwise at records[1]
    const hostnameIndex = ensSubdomainKey === MAINNET_SUBDOMAIN ? 0 : 1;

    const validRelayers: IRelayerInfo[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const data = aggregatorData[i];

      if (!data) continue;

      const hostname = data.records[hostnameIndex];

      if (
        !data.isRegistered ||
        data.balance < MIN_STAKE_BALANCE ||
        data.owner !== event.relayerAddress ||
        !data.records[0] || // mainnet subdomain must exist
        !hostname ||
        hostname.includes('http://') ||
        hostname.includes('https://')
      ) {
        continue;
      }

      validRelayers.push({
        ensName: event.ensName,
        hostname,
        relayerAddress: data.owner,
        stakeBalance: data.balance,
      });
    }

    if (validRelayers.length > 0) {
      dispatch(registerRelayers(validRelayers));
    }
  },
);
