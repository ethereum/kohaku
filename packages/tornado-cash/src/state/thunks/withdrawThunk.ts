import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { quoteThunk, QuoteToken } from "./quoteThunk";
import { IRelayerClient } from "../../relayer/interfaces/relayer-client.interface";
import { assetSelector, instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { Address } from "../../interfaces/types.interface";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { instanceCatalog, ITornadoInstance } from "../../instances";
import { findPoolPaymaster } from "../../paymaster/config";

export interface WithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposit' | 'fee' | 'relayerAddress'> {
    relayerClient: IRelayerClient;
    dataService: IDataService;
    assetAddress: bigint;
    amount?: bigint;
    preferredRelayersEns?: Set<string>;
    /** Source of the reference token price (the paymaster's TWAP) for ERC-20 pools. */
    paymasterConfig?: IChainsPaymastersConfig;
    /** Overrides the built-in instance catalog for this chain. */
    instances?: readonly ITornadoInstance[];
}

const WITHDRAW_GAS = 550_000n;

export const withdrawThunk = createAsyncThunk<
    IWithdrawalPayload[],
    WithdrawThunkParams,
    { state: RootState }
>('withdraw/executeWithdrawals', async ({
    relayerClient,
    dataService,
    assetAddress,
    amount,
    preferredRelayersEns,
    paymasterConfig,
    instances,
    ...rest
}, { getState, dispatch }) => {
    const state = getState();
    const deposits = getWithdrawableDepositsSelector(state, assetAddress, amount);

    if (!deposits.length) throw new Error(`No deposits found for asset ${assetAddress}`);

    const pools = poolsSelector(state);
    const poolInfo = pools.get(deposits[0]!.pool);

    if (!poolInfo) throw new Error(`No pool found for asset ${assetAddress}`);

    const denominations = deposits.map((deposit) => {
      const pool = pools.get(deposit.pool);

      if (!pool) throw new Error('Pool not found');

      return pool.denomination;
    });

    const uniqueDepositPools = [...new Set(deposits.map((d) => d.pool))];

    unwrapResult(
      await dispatch(verifyRootsThunk({
        dataService,
        onlyThesePools: uniqueDepositPools,
      }))
    )

    const gasPrice = await dataService.getGasPrice();
    const networkFee = gasPrice * WITHDRAW_GAS;
    let token: QuoteToken | undefined;

    if (poolInfo.isERC20) {
      const { chainId } = instanceRegistryInfoSelector(state);
      // Catalog metadata first: the assets slice is read from the RPC.
      const asset = instanceCatalog(chainId, instances)?.get(poolInfo.address) ?? assetSelector(state).get(assetAddress as Address);

      if (!asset) throw new Error(`Asset info not found for ${assetAddress}`);

      const chainPaymaster = paymasterConfig?.[Number(chainId)];
      const paymasterAddress = chainPaymaster && findPoolPaymaster(chainPaymaster, poolInfo.address);
      // Without a paymaster quote for this token only the total fee cap applies.
      const referenceNetworkFee = paymasterAddress
        ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, assetAddress, networkFee).catch(() => undefined)
        : undefined;

      token = { symbol: asset.symbol, decimals: asset.decimals, referenceNetworkFee };
    }

    const { relayerUrl, rewardAccount, fees } = unwrapResult(await dispatch(
      quoteThunk({
        relayerClient,
        preferredRelayersEns,
        denominations,
        networkFee,
        token,
      }),
    ));

    const results: IWithdrawalPayload[] = [];

    for (const [i, deposit] of deposits.entries()) {
      const fee = fees[i]!;
      const proof = unwrapResult(await dispatch(
        withdrawalsProofThunk({
          ...rest,
          deposit,
          relayerAddress: BigInt(rewardAccount) as Address,
          fee,
        }),
      ));

      results.push({
        mode: 'relayer' as const,
        proof,
        poolAddress: deposit.pool,
        relayerUrl,
        fee,
        denomination: denominations[i]!,
      });
    }

    return results;
});
