import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { encodePaymasterData, encodeTornadoAdapterData } from "@privacy-paymasters/sdk";
import { generatePrivateKey } from "viem/accounts";

import { computeMinimumViableFee, reasonableGasUnits } from "../../paymaster/fee";
import { buildSignedTornadoUserOp, setupBundlerClient } from "../../paymaster/utils";
import { DelegationConfig, IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";

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

  const { standard: { maxFeePerGas, maxPriorityFeePerGas } } = await bundlerClient.getUserOperationGasPrice();

  const gasUnits = reasonableGasUnits(poolInfo.isERC20);
  const ethFee = computeMinimumViableFee(gasUnits, maxFeePerGas);
  // Price the ERC20 fee via the paymaster's own oracle (same pool/TWAP it
  // enforces in validation), so feePaid >= required holds by construction.
  const fee = poolInfo.isERC20
    ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
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

  // Each deposit is withdrawn through its own ephemeral 7702 sender. The signer
  // is either derived deterministically from the deposit (so it can be
  // reproduced) or generated randomly. Because the sender is reached via a
  // paymaster + Simple7702 owner signature, the userOp must be fully built and
  // signed here — the broadcaster only relays it. The withdrawal recipient is a
  // user address (distinct from the ephemeral sender), so callGasLimit is 0.
  const bigintChainId = await dataService.getChainId();
  const userOpGas = { ...gasUnits, callGasLimit: 0n };

  const userOperations = await Promise.all(
    proofOutputs.map(async ({ poolAddress, ...proof }, i) => {
      const deposit = deposits[i]!;

      const privateKey = delegation?.mode === 'deterministic'
        ? await secretManager.deriveEphemeralSigner({
            depositIndex: deposit.index,
            chainId: bigintChainId,
            poolAddress: deposit.pool,
          })
        : generatePrivateKey();

      const [root, nullifierHash, recipient, relayerArg, feeArg, refundArg] = proof.args;

      const paymasterData = encodePaymasterData(
        poolAcountsMap.get(poolAddress)!,
        encodeTornadoAdapterData(
          proof.proof,
          root,
          nullifierHash,
          recipient,
          relayerArg,
          BigInt(feeArg),
          BigInt(refundArg),
        ),
      );

      return buildSignedTornadoUserOp({
        privateKey,
        chainId,
        paymasterAddress,
        paymasterData,
        gas: userOpGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
    }),
  );

  return proofOutputs.map(({ poolAddress, ...proof }, i) => ({
    mode: 'paymaster' as const,
    proof,
    poolAddress,
    isERC20: poolInfo.isERC20,
    paymasterAddress: paymasterAddress,
    entryPointAddress: entryPointAddress,
    bundlerUrl,
    userOperation: userOperations[i]!,
  })) satisfies IGenericPaymasterWithdrawalPayload[];
});
