import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { AccountId } from "@kohaku-eth/plugins";
import { TxData } from "@kohaku-eth/provider";
import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { encodePaymasterData, encodeTornadoAdapterData } from "@privacy-paymasters/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { computeMinimumViableFee, reasonableGasUnits } from "../../paymaster/fee";
import { buildSignedTornadoUserOp, createPaymasterBundlerClient, getUserOperationGasPrice } from "../../paymaster/utils";
import { DelegatorAccount } from "../../account/delegation.interface";
import { DelegationConfig, IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";
import { SerializedUserOperation } from "../../interfaces/user-ops.interface";

// A BIP-32 path: `m` followed by one or more `/index` segments, each optionally
// hardened with a trailing apostrophe (e.g. m/44'/60'/0'/0/0).
const BIP32_PATH = /^m(\/\d+'?)+$/;

function assertValidDelegatorPath(path: string): void {
  if (!BIP32_PATH.test(path)) {
    throw new Error(`Invalid delegation path "${path}": expected a BIP-32 path like m/44'/60'/0'/0/0`);
  }
}

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

  const ephemeralSigner = async (deposit: (typeof deposits)[number]): Promise<DelegatorAccount> =>
    privateKeyToAccount(await secretManager.deriveEphemeralSigner({
      depositIndex: deposit.index,
      chainId: bigintChainId,
      poolAddress: deposit.pool,
    }));

  // Tail calls: every deposit shares one delegator so all withdrawals land in the
  // same EOA (the recipient), and the last userOp spends the accumulated balance.
  // That EOA holds the funds, so it is recoverable by default (`random` opts out).
  const resolveBatchDelegator = async (): Promise<DelegatorAccount> => {
    if (delegation?.mode === 'random') return privateKeyToAccount(generatePrivateKey());
    if (delegation?.mode === 'deterministic' && delegation.path) {
      assertValidDelegatorPath(delegation.path);
      return privateKeyToAccount(await secretManager.deriveDelegatorSigner({ path: delegation.path }));
    }
    return ephemeralSigner(deposits[0]!);
  };

  // No tail calls: a per-deposit sender that never holds funds (the withdrawal
  // goes to the user's `recipient`), so a random default is fine.
  const resolveIndependentSigner = (deposit: (typeof deposits)[number]): Promise<DelegatorAccount> =>
    delegation?.mode === 'deterministic'
      ? ephemeralSigner(deposit)
      : Promise.resolve(privateKeyToAccount(generatePrivateKey()));

  const sharedDelegator = tailCalls ? await resolveBatchDelegator() : null;

  const proofOutputs: (TornadoProveOutput & { poolAddress: bigint })[] = [];
  const userOperations: SerializedUserOperation[] = [];

  for (let i = 0; i < deposits.length; i++) {
    const deposit = deposits[i]!;
    const isLast = i === deposits.length - 1;

    const signer = sharedDelegator ?? await resolveIndependentSigner(deposit);

    const recipient = sharedDelegator
      ? BigInt(signer.address) as Address
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
        signer,
        chainId,
        paymasterAddress,
        paymasterData,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        tailCalls: effectiveTailCalls,
        // When sharing one delegator across multiple deposits each userOp needs
        // a distinct nonce (0, 1, 2 …) on the shared sender.
        nonce: sharedDelegator ? BigInt(i) : 0n,
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
