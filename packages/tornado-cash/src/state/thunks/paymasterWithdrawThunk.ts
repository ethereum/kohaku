import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { computeMinimumViableFee, reasonableGasUnits } from "../../paymaster/fee";
import { setupBundlerClient, signDelegationAuthorization } from "../../paymaster/utils";
import { DelegationConfig, IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { IGenericPaymasterWithdrawalPayload, SignedDelegation } from "../../relayer/interfaces/paymaster-client.interface";
import { TornadoProveOutput } from "../../utils/tornado-prover";

export interface PaymasterWithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposit' | 'fee' | 'relayerAddress'> {
  dataService: IDataService;
  assetAddress: bigint;
  amount?: bigint;
  paymasterSettings: IChainsPaymastersConfig & {
    delegation?: DelegationConfig;
  };
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
  paymasterSettings: {
    delegation,
    ...paymasterConfig
  },
  secretManager,
  ...rest
}, { getState, dispatch }) => {
  const state = getState();
  const { chainId: rawChainId } = instanceRegistryInfoSelector(state);
  const chainId = Number(rawChainId);
  const deposits = getWithdrawableDepositsSelector(state, assetAddress, amount);
  const poolsToWithdrawFrom = [...new Set(deposits.map((d) => d.pool))];

  const pools = poolsSelector(state);
  const poolInfo = pools.get(deposits[0]!.pool);

  if (!poolInfo) throw new Error(`No pool found for asset ${assetAddress}`);

  const {
    bundlerUrl,
    entryPointAddress,
    paymasterAddress,
    poolsAccountsMap: rawPoolsAccountsMap,
  } = paymasterConfig[chainId]!;

  const poolAcountsMap = new Map(
    Object.entries(rawPoolsAccountsMap)
      .map(([poolAccount, tornadoAccount]) => [
        BigInt(poolAccount) as Address,
        tornadoAccount
      ] as const)
    )

  unwrapResult(
    await dispatch(verifyRootsThunk({
      dataService,
      onlyThesePools: poolsToWithdrawFrom
    }))
  );

  const bundlerClient = setupBundlerClient({
    bundlerUrl: bundlerUrl,
    entryPointAddress: entryPointAddress,
    chainId: Number(state.instanceRegistryInfo.chainId)
  });

  const { standard: { maxFeePerGas } } = await bundlerClient.getUserOperationGasPrice();

  const gasUnits = reasonableGasUnits(poolInfo.isERC20);
  const ethFee = computeMinimumViableFee(gasUnits, maxFeePerGas);
  const fee = poolInfo.isERC20
    ? await dataService.quoteEthToToken(ethFee, poolInfo.asset, poolInfo.uniswapPoolSwappingFee)
    : ethFee;

  // The relayer address in the proof is the paymaster — it receives the fee
  const relayerAddress = BigInt(paymasterAddress) as Address;

  const getProofOutputs = async () => {
    const results: (TornadoProveOutput & {poolAddress: bigint})[] = [];

    for (const deposit of deposits) {
      const withdrawResultAction = await dispatch(
        withdrawalsProofThunk({
          ...rest,
          deposit,
          relayerAddress,
          fee,
        }),
      );
  
      results.push({
        ...unwrapResult(withdrawResultAction),
        poolAddress: deposit.pool
      });
    }

    return results;
  }

  const proofOutputs = await getProofOutputs();

  // Compute delegation only for deterministic mode — random is deferred to broadcast.
  // Each deposit gets its own signer derived from its deposit index.
  let delegations: (SignedDelegation | undefined)[];

  if (delegation?.mode === 'deterministic') {
    const chainId = await dataService.getChainId();

    delegations = await Promise.all(
      deposits.map(async ({ index, pool }) => {
        const ephemeralPk = await secretManager.deriveEphemeralSigner({
          depositIndex: index,
          chainId,
          poolAddress: pool,
        });

        return signDelegationAuthorization({
          privateKey: ephemeralPk,
          accountAddress: poolAcountsMap.get(pool)!,
          chainId: Number(chainId),
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
    isERC20: poolInfo.isERC20,
    paymasterAddress: paymasterAddress,
    entryPointAddress: entryPointAddress,
    bundlerUrl,
    accountAddress: poolAcountsMap.get(poolAddress)!,
    delegation: delegations[i],
  })) satisfies IGenericPaymasterWithdrawalPayload[];
});
