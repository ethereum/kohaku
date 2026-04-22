import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { quoteThunk } from "./quoteThunk";
import { IRelayerClient } from "../../relayer/interfaces/relayer-client.interface";
import { poolFromAssetSelector } from "../selectors/pools.selector";
import { assetSelector } from "../selectors/slices.selectors";
import { Address } from "../../interfaces/types.interface";
import { IIndexedDepositWithSecrets } from "../../data/interfaces/events.interface";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { verifyRootsThunk } from "./verifyRootsThunk";

export interface WithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposits' | 'fee' | 'relayerAddress'> {
    getWithdrawableDeposits: (asset: Address, amount?: bigint) => IIndexedDepositWithSecrets[];
    relayerClient: IRelayerClient;
    dataService: IDataService;
    assetAddress: bigint;
    amount?: bigint;
    preferredRelayersEns?: Set<string>;
}

export const withdrawThunk = createAsyncThunk<
    IWithdrawalPayload[],
    WithdrawThunkParams,
    { state: RootState }
>('withdraw/executeWithdrawals', async ({
    getWithdrawableDeposits,
    relayerClient,
    dataService,
    assetAddress,
    amount,
    preferredRelayersEns,
    ...rest
}, { getState, dispatch }) => {
    const state = getState();
    const deposits = getWithdrawableDeposits(assetAddress, amount);
    const poolInfo = poolFromAssetSelector(state, assetAddress);

    if (!poolInfo) throw new Error(`No pool found for asset ${assetAddress}`);

    unwrapResult(
      await dispatch(verifyRootsThunk({
        dataService,
        onlyThesePools: [poolInfo.address]
      }))
    )

      // Get best relayer quote
      const quoteResultAction = await dispatch(
        quoteThunk({
          relayerClient: relayerClient,
          preferredRelayersEns,
          isERC20: poolInfo.isERC20,
        }),
      );

      const { relayerUrl, rewardAccount, tornadoServiceFee, ethPrices } = unwrapResult(quoteResultAction);

      const WITHDRAW_GAS = 550_000n;
      const gasPrice = await dataService.getGasPrice();
      const networkFee = gasPrice * WITHDRAW_GAS;
      const serviceFee = poolInfo.denomination * BigInt(Math.round(tornadoServiceFee * 100)) / 10_000n;

      let fee: bigint;

      if (poolInfo.isERC20) {
        const asset = assetSelector(state).get(assetAddress as Address);

        if (!asset) throw new Error(`Asset info not found for ${assetAddress}`);

        const tokenPriceStr =
          ethPrices[asset.symbol.toLowerCase()] ??
          ethPrices[asset.symbol.toUpperCase()] ??
          ethPrices[asset.symbol];

        if (!tokenPriceStr) throw new Error(`No ETH price found for token ${asset.symbol}`);

        const tokenPrice = BigInt(tokenPriceStr);

        if (tokenPrice === 0n) throw new Error(`Token price is zero for ${asset.symbol}`);

        const ethFeeInToken = networkFee * (10n ** BigInt(asset.decimals)) / tokenPrice;

        fee = ethFeeInToken + serviceFee;
      } else {
        fee = networkFee + serviceFee;
      }

      // Generate proofs for each deposit
      const withdrawResultAction = await dispatch(
            withdrawalsProofThunk({
                ...rest,
                deposits,
                relayerAddress: BigInt(rewardAccount) as Address,
                fee,
            }),
      );

      const proofOutputs = unwrapResult(withdrawResultAction);

      return proofOutputs.map((proof) => ({
          proof,
          poolAddress: poolInfo.address,
          relayerUrl,
      })) satisfies IWithdrawalPayload[];
});
