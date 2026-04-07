import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { quoteThunk } from "./quoteThunk";
import { IRelayerClient } from "../../relayer/interfaces/relayer-client.interface";
import { poolFromAssetSelector } from "../selectors/pools.selector";
import { Address } from "../../interfaces/types.interface";
import { IIndexedDepositWithSecrets } from "../../data/interfaces/events.interface";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";

export interface WithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposits' | 'fee' | 'relayerAddress'> {
    getWithdrawableDeposits: (asset: Address, amount?: bigint) => IIndexedDepositWithSecrets[];
    relayerClient: IRelayerClient;
    assetAddress: bigint;
    amount?: bigint;
}

export const withdrawThunk = createAsyncThunk<
    IWithdrawalPayload[],
    WithdrawThunkParams,
    { state: RootState }
>('withdraw/executeWithdrawals', async ({
    getWithdrawableDeposits,
    relayerClient,
    assetAddress,
    amount,
    ...rest
}, { getState, dispatch }) => {
    const state = getState();
    const deposits = getWithdrawableDeposits(assetAddress, amount);

      // Get best relayer quote
      const quoteResultAction = await dispatch(
        quoteThunk({ relayerClient: relayerClient }),
      );

      const { relayerUrl, rewardAccount, tornadoServiceFee } = unwrapResult(quoteResultAction);

      const poolInfo = poolFromAssetSelector(state, assetAddress);

      if (!poolInfo) throw new Error(`No pool found for asset ${assetAddress}`);

      const fee = poolInfo.denomination * BigInt(Math.round(tornadoServiceFee * 100)) / 10000n;

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
