import { createAsyncThunk } from '@reduxjs/toolkit';
import { isHex } from 'viem';
import { IQuoteResponse, IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { Address } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { decodeRelayData, encodeRelayData } from '../../utils/encoding.utils';
import { RootState } from '../store';
import { entrypointInfoSelector } from '../selectors/slices.selectors';

export interface QuoteResult {
  quote: IQuoteResponse;
  relayerId: string;
  relayerUrl: string;
  /** Relay data decoded from the quote and checked against the request. */
  relayData: ReturnType<typeof decodeRelayData>;
}

export interface QuoteThunkParams {
  relayerClient: IRelayerClient;
  relayers: Map<string, string>; // name -> url
  asset: Address;
  amount: bigint;
  recipient: Address;
  extraGas?: boolean;
  /** The pool's on-chain `maxRelayFeeBPS`; quotes embedding a higher fee are dropped. */
  maxRelayFeeBPS?: bigint;
}

/**
 * Checks a relayer's `withdrawalData` before it is proved. The data is hashed into the
 * proof context, so the Entrypoint pays exactly the recipient and fee it encodes: a
 * relayer that is trusted blindly can name itself as recipient and take the withdrawal.
 */
export const validateWithdrawalData = (
  quote: IQuoteResponse,
  recipient: Address,
  maxRelayFeeBPS?: bigint,
): ReturnType<typeof decodeRelayData> => {
  const withdrawalData = quote.feeCommitment?.withdrawalData;

  if (typeof withdrawalData !== 'string' || !isHex(withdrawalData, { strict: true })) {
    throw new Error('withdrawalData is not hex');
  }

  const relayData = decodeRelayData(withdrawalData);

  // Only the canonical encoding is accepted, so what was checked is what the Entrypoint decodes.
  if (encodeRelayData(relayData).toLowerCase() !== withdrawalData.toLowerCase()) {
    throw new Error('withdrawalData is not a canonical RelayData encoding');
  }

  if (BigInt(relayData.recipient) !== recipient) {
    throw new Error(`withdrawalData pays ${relayData.recipient}, not the requested recipient ${addressToHex(recipient)}`);
  }

  if (relayData.relayFeeBps > BigInt(quote.feeBPS)) {
    throw new Error(`withdrawalData fee ${relayData.relayFeeBps} bps exceeds the quoted ${quote.feeBPS} bps`);
  }

  if (maxRelayFeeBPS !== undefined && relayData.relayFeeBps > maxRelayFeeBPS) {
    throw new Error(`withdrawalData fee ${relayData.relayFeeBps} bps exceeds the pool's maxRelayFeeBPS ${maxRelayFeeBPS}`);
  }

  return relayData;
};

export const quoteThunk = createAsyncThunk<
  QuoteResult,
  QuoteThunkParams,
  { state: RootState }
>(
  'quote/getBestQuote',
  async (params, { getState }) => {
    const { chainId } = entrypointInfoSelector(getState());
    const { relayerClient, relayers, asset, amount, recipient, extraGas, maxRelayFeeBPS } = params;

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

          const relayData = validateWithdrawalData(quote, recipient, maxRelayFeeBPS);

          return { quote, relayerId, relayerUrl, relayData };
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

    // Rank by the fee that will be charged on-chain, not the relayer's self-reported feeBPS.
    const bestQuote = validQuotes.reduce((best, current) =>
      current.relayData.relayFeeBps < best.relayData.relayFeeBps ? current : best,
    );

    return bestQuote;
  }
);
