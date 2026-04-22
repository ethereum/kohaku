import { createAsyncThunk } from '@reduxjs/toolkit';
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { RootState } from '../store';
import { instanceRegistryInfoSelector, relayerFeeConfigSelector, relayersSelector } from '../selectors/slices.selectors';

export interface QuoteResult {
  relayerId: string;
  relayerUrl: string;
  rewardAccount: string;
  tornadoServiceFee: number;
  ethPrices: Record<string, string>;
}

export interface QuoteThunkParams {
  relayerClient: IRelayerClient;
  preferredRelayersEns?: Set<string>;
  isERC20?: boolean;
}

export const quoteThunk = createAsyncThunk<
  QuoteResult,
  QuoteThunkParams,
  { state: RootState }
>(
  'quote/getBestQuote',
  async ({ relayerClient, preferredRelayersEns, isERC20 }, { getState }) => {
    const state = getState();
    const { chainId } = instanceRegistryInfoSelector(state);
    const relayers = relayersSelector(state);
    const { minFee, maxFee } = relayerFeeConfigSelector(state);

    if (relayers.length === 0) {
      throw new Error('No relayers available');
    }

    const relayersToUse = preferredRelayersEns ?
      relayers.filter(({ ensName }) => preferredRelayersEns.has(ensName)) :
      relayers;

    const quotePromises = relayersToUse.map(async (relayer): Promise<QuoteResult | null> => {
      const { ensName, hostname } = relayer;
      const relayerUrl = `https://${hostname}/`;

      try {
        const status = await relayerClient.getStatus(hostname);

        if (
          status.netId !== Number(chainId) ||
          status.currentQueue > 5 ||
          status.tornadoServiceFee < minFee ||
          status.tornadoServiceFee >= maxFee ||
          (isERC20 && !status.ethPrices)
        ) {
          return null;
        }

        return {
          relayerId: ensName,
          relayerUrl,
          rewardAccount: status.rewardAccount,
          tornadoServiceFee: status.tornadoServiceFee,
          ethPrices: status.ethPrices,
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((r): r is QuoteResult => r !== null);

    if (validQuotes.length === 0) {
      throw new Error('All relayers failed liveness check');
    }

    return validQuotes.reduce((best, current) =>
      current.tornadoServiceFee < best.tornadoServiceFee ? current : best
    );
  }
);
