import { createAsyncThunk } from '@reduxjs/toolkit';
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { RootState } from '../store';
import { instanceRegistryInfoSelector, relayerFeeConfigSelector, relayersSelector } from '../selectors/slices.selectors';
import { DEFAULT_MAX_PRICE_DEVIATION_BPS, DEFAULT_MAX_TOTAL_FEE_BPS } from '../slices/relayersSlice';

export interface QuoteResult {
  relayerId: string;
  relayerUrl: string;
  rewardAccount: string;
  tornadoServiceFee: number;
  /** Fee for each note, in the order of `denominations`. */
  fees: bigint[];
  totalFee: bigint;
}

export interface QuoteToken {
  symbol: string;
  decimals: number;
  /**
   * `networkFee` priced in the token by a source the relayer does not control
   * (the paymaster's on-chain TWAP). Omitted when unavailable.
   */
  referenceNetworkFee?: bigint;
}

export interface QuoteThunkParams {
  relayerClient: IRelayerClient;
  preferredRelayersEns?: Set<string>;
  /** Denomination of each note to withdraw. */
  denominations: bigint[];
  /** Gas cost of one withdrawal, in wei. */
  networkFee: bigint;
  /** Set for ERC-20 pools. */
  token?: QuoteToken;
}

const percent = (bps: number) => `${bps / 100}%`;

export const quoteThunk = createAsyncThunk<
  QuoteResult,
  QuoteThunkParams,
  { state: RootState }
>(
  'quote/getBestQuote',
  async ({ relayerClient, preferredRelayersEns, denominations, networkFee, token }, { getState }) => {
    const state = getState();
    const { chainId } = instanceRegistryInfoSelector(state);
    const relayers = relayersSelector(state);
    const {
      minFee,
      maxFee,
      maxTotalFeeBps = DEFAULT_MAX_TOTAL_FEE_BPS,
      maxPriceDeviationBps = DEFAULT_MAX_PRICE_DEVIATION_BPS,
    } = relayerFeeConfigSelector(state);

    if (relayers.length === 0) {
      throw new Error('No relayers available');
    }

    // Converted up front so a bad config throws here, not as a failed relayer.
    const totalFeeCap = BigInt(maxTotalFeeBps);
    const priceTolerance = BigInt(10_000 + maxPriceDeviationBps);

    const relayersToUse = preferredRelayersEns ?
      relayers.filter(({ ensName }) => preferredRelayersEns.has(ensName)) :
      relayers;

    const rejections: string[] = [];

    const quotePromises = relayersToUse.map(async (relayer): Promise<QuoteResult | null> => {
      const { ensName, hostname } = relayer;
      const relayerUrl = `https://${hostname}/`;
      const reject = (reason: string) => {
        rejections.push(`${ensName}: ${reason}`);

        return null;
      };

      try {
        const status = await relayerClient.getStatus(hostname);

        if (
          status.netId !== Number(chainId) ||
          status.currentQueue > 5 ||
          status.tornadoServiceFee < minFee ||
          status.tornadoServiceFee >= maxFee ||
          (token && !status.ethPrices)
        ) {
          return null;
        }

        // The relayer's /status sets the token price, so it is checked against
        // the reference quote and every fee against the cap before proving.
        let networkFeeInAsset = networkFee;

        if (token) {
          const { symbol, decimals, referenceNetworkFee } = token;
          const tokenPriceStr =
            status.ethPrices[symbol.toLowerCase()] ??
            status.ethPrices[symbol.toUpperCase()] ??
            status.ethPrices[symbol];

          if (!tokenPriceStr) return reject(`no ETH price for ${symbol}`);

          const tokenPrice = BigInt(tokenPriceStr);

          if (tokenPrice <= 0n) return reject(`non-positive ETH price for ${symbol}`);

          networkFeeInAsset = networkFee * (10n ** BigInt(decimals)) / tokenPrice;

          if (
            referenceNetworkFee !== undefined &&
            networkFeeInAsset * 10_000n > referenceNetworkFee * priceTolerance
          ) {
            return reject(
              `${symbol} price puts the network fee at ${networkFeeInAsset}, more than ${percent(maxPriceDeviationBps)} above the paymaster quote ${referenceNetworkFee}`,
            );
          }
        }

        const serviceFeeBps = BigInt(Math.round(status.tornadoServiceFee * 100));
        const fees = denominations.map((denomination) => networkFeeInAsset + denomination * serviceFeeBps / 10_000n);
        const overCap = fees.findIndex((fee, i) => fee * 10_000n > denominations[i]! * totalFeeCap);

        if (overCap !== -1) {
          return reject(`fee ${fees[overCap]} is more than ${percent(maxTotalFeeBps)} of the ${denominations[overCap]} note`);
        }

        return {
          relayerId: ensName,
          relayerUrl,
          rewardAccount: status.rewardAccount,
          tornadoServiceFee: status.tornadoServiceFee,
          fees,
          totalFee: fees.reduce((sum, fee) => sum + fee, 0n),
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((r): r is QuoteResult => r !== null);

    if (validQuotes.length === 0) {
      throw new Error(rejections.length > 0
        ? `No relayer quote within fee limits (${rejections.join('; ')})`
        : 'All relayers failed liveness check');
    }

    // Rank by what the user actually pays, not the advertised service fee.
    return validQuotes.reduce((best, current) =>
      current.totalFee < best.totalFee ? current : best
    );
  }
);
