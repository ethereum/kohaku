import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { AccountId } from "@kohaku-eth/plugins";
import { TxData } from "@kohaku-eth/provider";
import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { encodePaymasterData, encodeTornadoAdapterData } from "@privacy-paymasters/sdk";
import { generatePrivateKey } from "viem/accounts";

import { computeMinimumViableFee, reasonableGasUnits } from "../../paymaster/fee";
import { buildSignedTornadoUserOp, createPaymasterBundlerClient, ephemeralSenderAddress, getUserOperationGasPrice } from "../../paymaster/utils";
import { DelegationConfig, IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";
import { SerializedUserOperation } from "../../interfaces/user-ops.interface";

export interface PaymasterWithdrawThunkParams extends Omit<WithdrawalProofsThunkParams, 'deposit' | 'fee' | 'relayerAddress'> {
  dataService: IDataService;
  assetAddress: bigint;
  amount?: bigint;
  paymasterSettings: IChainsPaymastersConfig & {
    delegation?: DelegationConfig;
  };
  secretManager: ISecretManager;
  tailCalls?: (address: AccountId) => Promise<TxData[]>;
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
  tailCalls,
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

  const bundlerClient = createPaymasterBundlerClient(bundlerUrl);

  const { standard: { maxFeePerGas, maxPriorityFeePerGas } } = await getUserOperationGasPrice(bundlerClient);

  const gasUnits = reasonableGasUnits(poolInfo.isERC20);
  const ethFee = computeMinimumViableFee(gasUnits, maxFeePerGas);
  // Price the ERC20 fee via the paymaster's own oracle (same pool/TWAP it
  // enforces in validation), so feePaid >= required holds by construction.
  const fee = poolInfo.isERC20
    ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
    : ethFee;

  // The relayer address in the proof is the paymaster — it receives the fee
  const relayerAddress = BigInt(paymasterAddress) as Address;

  const bigintChainId = await dataService.getChainId();
  const { recipient: originalRecipient, ...restWithoutRecipient } = rest;

  // When tailCalls are present, all deposits in this batch share one ephemeral
  // key so every withdrawal lands in the same EOA. The last userOp then runs
  // tailCalls against the full accumulated balance. Deterministic derivation is
  // skipped in this path — reproducibility of a shared batch key is meaningless.
  const sharedPrivateKey = tailCalls ? generatePrivateKey() : null;

  const proofOutputs: (TornadoProveOutput & { poolAddress: bigint })[] = [];
  const userOperations: SerializedUserOperation[] = [];

  for (let i = 0; i < deposits.length; i++) {
    const deposit = deposits[i]!;
    const isLast = i === deposits.length - 1;

    const privateKey = sharedPrivateKey
      ?? (delegation?.mode === 'deterministic'
          ? await secretManager.deriveEphemeralSigner({
              depositIndex: deposit.index,
              chainId: bigintChainId,
              poolAddress: deposit.pool,
            })
          : generatePrivateKey());

    const recipient = sharedPrivateKey
      ? BigInt(ephemeralSenderAddress(privateKey)) as Address
      : originalRecipient;

    // Only the final userOp in a tailCalls batch carries the execution phase.
    // Earlier ones are pure withdrawals with callGasLimit = 0.
    const effectiveTailCalls = isLast ? tailCalls : undefined;
    const gas = { ...gasUnits, callGasLimit: effectiveTailCalls ? gasUnits.callGasLimit : 0n };

    const withdrawResultAction = await dispatch(
      withdrawalsProofThunk({
        ...restWithoutRecipient,
        recipient,
        deposit,
        relayerAddress,
        fee,
      }),
    );

    const proof = { ...unwrapResult(withdrawResultAction), poolAddress: deposit.pool };

    proofOutputs.push(proof);

    const { poolAddress, ...proofArgs } = proof;
    const [root, nullifierHash, proofRecipient, relayerArg, feeArg, refundArg] = proofArgs.args;

    const paymasterData = encodePaymasterData(
      poolAcountsMap.get(poolAddress)!,
      encodeTornadoAdapterData(
        proofArgs.proof,
        root,
        nullifierHash,
        proofRecipient,
        relayerArg,
        BigInt(feeArg),
        BigInt(refundArg),
      ),
    );

    userOperations.push(
      await buildSignedTornadoUserOp({
        privateKey,
        chainId,
        paymasterAddress,
        paymasterData,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        tailCalls: effectiveTailCalls,
        // When sharing one ephemeral key across multiple deposits each userOp
        // needs a distinct nonce (0, 1, 2 …) on the shared sender.
        nonce: sharedPrivateKey ? BigInt(i) : 0n,
      }),
    );
  }

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
