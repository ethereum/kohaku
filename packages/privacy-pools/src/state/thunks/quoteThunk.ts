import { createAsyncThunk } from '@reduxjs/toolkit';
import { isHex } from 'viem';
import { IQuoteResponse, IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { PPv1RelayerQuoteError, type PPv1RelayerQuoteFailure } from '../../relayer/quote-error';
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
  /**
   * Whether the quote's signed fee commitment is sent with the relay request
   * (default). Exact-output withdrawals embed their own fee and omit it, so a
   * quote without a usable signature still serves them.
   */
  requireCommitment?: boolean;
}

class RelayFeeTooHighError extends Error {
  constructor(readonly requiredFeeBPS: bigint, readonly maxRelayFeeBPS: bigint) {
    super(`withdrawalData fee ${requiredFeeBPS} bps exceeds the pool's maxRelayFeeBPS ${maxRelayFeeBPS}`);
  }
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

  // RelayData is three static ABI words (96 bytes).
  if (typeof withdrawalData !== 'string' || withdrawalData.length !== 194 || !isHex(withdrawalData, { strict: true })) {
    throw new Error('withdrawalData is not a canonical RelayData hex encoding');
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
    throw new RelayFeeTooHighError(relayData.relayFeeBps, maxRelayFeeBPS);
  }

  return relayData;
};

/**
 * Checks the rest of a quote's fee commitment before it is ranked: an expired
 * quote, or one without a signature to send back, is refused by the relayer
 * only after the SDK has proved. The signature itself is the relayer's own and
 * is verified by the relayer, so only its shape is checked here.
 */
export const validateFeeCommitment = (quote: IQuoteResponse, { requireCommitment = true, now = Date.now() } = {}): void => {
  const { expiration, signedRelayerCommitment } = quote.feeCommitment ?? {};

  if (typeof expiration !== 'number' || !Number.isFinite(expiration)) {
    throw new Error('quote has no expiration');
  }

  if (expiration <= now) {
    throw new Error(`quote expired ${now - expiration} ms ago`);
  }

  if (requireCommitment && (typeof signedRelayerCommitment !== 'string' || signedRelayerCommitment === '0x' || !isHex(signedRelayerCommitment, { strict: true }))) {
    throw new Error('quote has no signed fee commitment');
  }
};

export const quoteThunk = createAsyncThunk<
  QuoteResult,
  QuoteThunkParams,
  { state: RootState; rejectValue: PPv1RelayerQuoteError }
>(
  'quote/getBestQuote',
  async (params, { getState, rejectWithValue }) => {
    const { chainId } = entrypointInfoSelector(getState());
    const { relayerClient, relayers, asset, amount, recipient, extraGas, maxRelayFeeBPS, requireCommitment } = params;

    if (relayers.size === 0) {
      return rejectWithValue(new PPv1RelayerQuoteError([]));
    }

    // Query all relayers in parallel
    const quotePromises = Array.from(relayers.entries()).map(
      async ([relayerId, relayerUrl]): Promise<QuoteResult | PPv1RelayerQuoteFailure> => {
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

          validateFeeCommitment(quote, { requireCommitment });

          return { quote, relayerId, relayerUrl, relayData };
        } catch (error) {
          const message = typeof error === 'string' ? error :
            error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
              ? error.message : 'Unknown relayer error';
          const failure: PPv1RelayerQuoteFailure = {
            relayerId, relayerUrl, message,
            ...(error instanceof RelayFeeTooHighError
              ? { reason: 'fee-too-high', requiredFeeBPS: error.requiredFeeBPS, maxRelayFeeBPS: error.maxRelayFeeBPS }
              : { reason: 'quote-failed' }),
          };

          console.warn(`Relayer ${relayerId} failed to quote:`, message);

          return failure;
        }
      }
    );

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((r): r is QuoteResult => 'quote' in r);

    if (validQuotes.length === 0) {
      const failures = results.filter((r): r is PPv1RelayerQuoteFailure => 'reason' in r);

      // Keep the Error instance and its fields intact through Redux's unwrap().
      return rejectWithValue(new PPv1RelayerQuoteError(failures));
    }

    // Rank by the fee that will be charged on-chain, not the relayer's self-reported feeBPS.
    const bestQuote = validQuotes.reduce((best, current) =>
      current.relayData.relayFeeBps < best.relayData.relayFeeBps ? current : best,
    );

    return bestQuote;
  }
);
