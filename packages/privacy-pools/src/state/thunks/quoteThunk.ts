import { createAsyncThunk } from '@reduxjs/toolkit';
import { IQuoteResponse, IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { Address } from '../../interfaces/types.interface';
import { RootState } from '../store';
import { entrypointInfoSelector } from '../selectors/slices.selectors';

export interface QuoteResult {
  quote: IQuoteResponse;
  relayerId: string;
  relayerUrl: string;
}

export interface QuoteThunkParams {
  relayerClient: IRelayerClient;
  relayers: Map<string, string>; // name -> url
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
  quote: IQuoteResponse,
  recipient: Address,
  amount: bigint,
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
    const { chainId } = entrypointInfoSelector(getState());
    const { relayerClient, relayers, asset, amount, recipient, extraGas } = params;

    if (relayers.size === 0) {
      throw new Error('No relayers configured');
    }

    // Query all relayers in parallel
    const quotePromises = Array.from(relayers.entries()).map(
      async ([relayerId, relayerUrl]): Promise<QuoteResult | null> => {
        try {
          const quote = await relayerClient.getQuote({
            relayerUrl,
            chainId,
            asset,
            amount,
            recipient,
            extraGas,
          });

          // Validate withdrawalData to prevent malicious relayers
          validateWithdrawalData(quote, recipient, amount, relayerId);

          return { quote, relayerId, relayerUrl };
        } catch (error) {
          // Log but don't fail - other relayers might succeed
          console.warn(`Relayer ${relayerId} failed to quote:`, error);

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
    const bestQuote = validQuotes.reduce((best, current) => {
      const bestFee = BigInt(best.quote.feeBPS);
      const currentFee = BigInt(current.quote.feeBPS);

      return currentFee < bestFee ? current : best;
    });

    return bestQuote;
  }
);
