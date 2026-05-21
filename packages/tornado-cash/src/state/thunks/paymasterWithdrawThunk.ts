import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { computeMinimumViableFee, reasonableGasUnits } from "../../paymaster/fee";
import { setupBundlerClient, signDelegationAuthorization } from "../../paymaster/utils";
import { IPaymasterConfig, IWithdrawalPayload, SignedDelegation } from "../../plugin/interfaces/protocol-params.interface";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";

export interface PaymasterWithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposit' | 'fee' | 'relayerAddress'> {
  dataService: IDataService;
  assetAddress: bigint;
  amount?: bigint;
  paymasterConfig: IPaymasterConfig;
  secretManager: ISecretManager;
}

export const paymasterWithdrawThunk = createAsyncThunk<
  IWithdrawalPayload[],
  PaymasterWithdrawThunkParams,
  { state: RootState; }
>('withdraw/executePaymasterWithdrawals', async ({
  dataService,
  assetAddress,
  amount,
  paymasterConfig,
  secretManager,
  ...rest
}, { getState, dispatch }) => {
  const state = getState();
  const deposits = getWithdrawableDepositsSelector(state, assetAddress, amount);
  const poolsToWithdrawFrom = [...new Set(deposits.map((d) => d.pool))];

  unwrapResult(
    await dispatch(verifyRootsThunk({
      dataService,
      onlyThesePools: poolsToWithdrawFrom
    }))
  );

  const bundlerClient = setupBundlerClient({
    bundlerUrl: paymasterConfig.bundlerUrl,
    entryPointAddress: paymasterConfig.entryPointAddress,
    chainId: Number(state.instanceRegistryInfo.chainId)
  });

  const { standard: { maxFeePerGas } } = await bundlerClient.getUserOperationGasPrice();

  const fee = computeMinimumViableFee(reasonableGasUnits, maxFeePerGas);

  // The relayer address in the proof is the paymaster — it receives the fee
  const relayerAddress = BigInt(paymasterConfig.paymasterAddress) as Address;

  const proofOutputs = await Promise.all(deposits.map(async (deposit) => {
    const withdrawResultAction = await dispatch(
      withdrawalsProofThunk({
        ...rest,
        deposit,
        relayerAddress,
        fee,
      }),
    );
  
    return {
      ...unwrapResult(withdrawResultAction),
      poolAddress: deposit.pool
    };
  }))


  // Compute delegation only for deterministic mode — random is deferred to broadcast.
  // Each deposit gets its own signer derived from its deposit index.
  let delegations: (SignedDelegation | undefined)[];

  if (paymasterConfig.delegation?.mode === 'deterministic') {
    const chainId = Number(await dataService.getChainId());

    delegations = await Promise.all(
      deposits.map(async (deposit) => {
        const ephemeralPk = await secretManager.deriveEphemeralSigner(deposit.index);

        return signDelegationAuthorization({
          privateKey: ephemeralPk,
          accountAddress: paymasterConfig.accountAddress,
          chainId,
          nonce: 0,
        });
      }),
    );
  } else {
    delegations = deposits.map(() => undefined);
  }

  return proofOutputs.map(({ poolAddress, ...proof }, i) => ({
    mode: 'paymaster' as const,
    proof,
    poolAddress,
    paymasterAddress: paymasterConfig.paymasterAddress,
    entryPointAddress: paymasterConfig.entryPointAddress,
    bundlerUrl: paymasterConfig.bundlerUrl,
    accountAddress: paymasterConfig.accountAddress,
    delegation: delegations[i],
  })) satisfies IWithdrawalPayload[];
});
