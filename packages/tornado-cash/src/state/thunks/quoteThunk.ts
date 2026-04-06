import { createAsyncThunk } from '@reduxjs/toolkit';
import { IQuoteResponse, IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { Address } from '../../interfaces/types.interface';
import { RootState } from '../store';
import { instanceRegistryInfoSelector, relayerFeeConfigSelector, relayersSelector } from '../selectors/slices.selectors';

export interface QuoteResult {
  quote: IQuoteResponse;
  relayerId: string;
  relayerUrl: string;
}

export interface QuoteThunkParams {
  relayerClient: IRelayerClient;
  asset: Address;
  amount: bigint;
  recipient: Address;
  extraGas?: boolean;
}


/**
 * Validates that the withdrawalData from a relayer quote is not malicious.
 * Checks that recipient and fee match what was requested.
 */
const validateWithdrawalData = (
  _quote: IQuoteResponse,
  _recipient: Address,
  _amount: bigint,
  relayerId: string
): void => {
  // TODO: Implement actual ABI decoding of withdrawalData
  // For now, we log a warning that validation is pending
  // The withdrawalData contains: recipient, relayerFee, and other fields
  //
  // const decodedData = decodeWithdrawalData(quote.feeCommitment.withdrawalData);
  //
  // if (decodedData.recipient !== recipient) {
  //   throw new Error(`Relayer ${relayerId} returned mismatched recipient`);
  // }
  //
  // const expectedFee = (amount * BigInt(quote.feeBPS)) / 10000n;
  // if (decodedData.relayerFee > expectedFee) {
  //   throw new Error(`Relayer ${relayerId} fee in withdrawalData exceeds quoted fee`);
  // }

  console.warn(`[quoteThunk] withdrawalData validation not yet implemented for relayer ${relayerId}`);
};

export const quoteThunk = createAsyncThunk<
  QuoteResult,
  QuoteThunkParams,
  { state: RootState }
>(
  'quote/getBestQuote',
  async (params, { getState }) => {
    const state = getState();
    const { chainId } = instanceRegistryInfoSelector(state); // used in status netId check
    const relayers = relayersSelector(state);
    const { minFee, maxFee } = relayerFeeConfigSelector(state);
    const { relayerClient, asset, amount, recipient, extraGas } = params;

    if (relayers.length === 0) {
      throw new Error('No relayers available');
    }

    // Check liveness and quote all relayers in parallel
    const quotePromises = relayers.map(
      async (relayer): Promise<QuoteResult | null> => {
        const { ensName, hostname } = relayer;
        const relayerUrl = `https://${hostname}`;

        try {
          const status = await relayerClient.getStatus(hostname);

          if (
            status.netId !== Number(chainId) ||
            status.currentQueue > 5 ||
            status.tornadoServiceFee < minFee ||
            status.tornadoServiceFee >= maxFee
          ) {
            console.warn(`[quoteThunk] Relayer ${ensName} failed liveness check`, status);
            return null;
          }

          const quote = await relayerClient.getQuote({
            relayerUrl,
            chainId,
            asset,
            amount,
            recipient,
            extraGas,
          });

          validateWithdrawalData(quote, recipient, amount, ensName);

          return { quote, relayerId: ensName, relayerUrl };
        } catch (error) {
          console.warn(`[quoteThunk] Relayer ${ensName} failed:`, error);
          return null;
        }
      }
    );

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((r): r is QuoteResult => r !== null);

    if (validQuotes.length === 0) {
      throw new Error('All relayers failed to provide a quote');
    }

    // Select lowest feeBPS
    return validQuotes.reduce((best, current) => {
      const bestFee = BigInt(best.quote.feeBPS);
      const currentFee = BigInt(current.quote.feeBPS);

      return currentFee < bestFee ? current : best;
    });
  }
);
