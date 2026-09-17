/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { TxData } from "@kohaku-eth/provider";
import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ISecretManager } from "../../account/keys";
import { E_ADDRESS } from "../../config";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { DelegationConfig, DelegatorAccount, UserOpGasLimits } from "../../interfaces/user-ops.interface";
import { computeMinimumViableFee, reasonableGasUnits, TAIL_CALLS_DEFAULT_GAS } from "../../paymaster/fee";
import { encodeFeeData, encodePaymasterData, encodePrivacyPoolAdapterData } from "../../paymaster/adapter-data";
import {
  buildSignedUserOp,
  createPaymasterBundlerClient,
  estimateUserOperationGas,
  getUserOperationGasPrice,
} from "../../paymaster/utils";
import { IPaymasterConfig } from "../../plugin/interfaces/protocol-params.interface";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";
import { WithdrawalPayload } from "../../relayer/interfaces/relayer-client.interface";
import { addressToHex } from "../../utils";
import { calculateContext } from "../../utils/proof.util";
import { getNoteSelector } from "../selectors/notes.selector";
import { poolFromAssetSelector } from "../selectors/pools.selector";
import { entrypointInfoSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawProveOutput, WithdrawThunkParams, withdrawThunk } from "./withdrawThunk";

export interface PaymasterWithdrawThunkParams {
  getNextNote: WithdrawThunkParams["getNextNote"];
  proverFactory: () => ReturnType<typeof Prover>;
  dataService: IDataService;
  secretManager: ISecretManager;
  asset: Address;
  amount?: bigint;
  recipient: Address;
  paymasterConfig: IPaymasterConfig;
  delegation?: DelegationConfig;
  /**
   * Optional execution-phase calls the ephemeral sender runs after the
   * withdrawal. When present, the withdrawn funds (minus fee) are paid to the
   * sender and these calls spend them atomically; `recipient` is ignored for the
   * payout (it stays the sender, as the adapter requires for a non-zero
   * callGasLimit).
   */
  tailCalls?: (sender: `0x${string}`) => Promise<TxData[]>;
  tailCallsGasEstimate?: bigint;
}

export const paymasterWithdrawThunk = createAsyncThunk<
  IGenericPaymasterWithdrawalPayload[],
  PaymasterWithdrawThunkParams,
  { state: RootState }
>(
  "withdraw/executePaymasterWithdrawals",
  async (
    {
      getNextNote,
      proverFactory,
      dataService,
      secretManager,
      asset,
      amount,
      recipient,
      paymasterConfig,
      delegation,
      tailCalls,
      tailCallsGasEstimate,
    },
    { getState, dispatch },
  ) => {
    const state = getState();
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    const poolInfo = poolFromAssetSelector(state, asset);

    if (!poolInfo) throw new Error(`No pool found for asset ${asset}`);

    const isERC20 = poolInfo.asset !== BigInt(E_ADDRESS);

    // Resolve the note first: it fixes the withdrawn value and the deposit index
    // used to derive a recoverable ephemeral sender.
    const note = getNoteSelector(state, asset, amount ?? 0n);

    if (!note) throw new Error("No note with sufficient balance for withdrawal");

    const withdrawnValue = amount ?? note.balance;

    if (withdrawnValue <= 0n) throw new Error("Withdrawal amount must be greater than zero");

    const { bundlerUrl, entryPointAddress, paymasterAddress, poolsAccountsMap } = paymasterConfig;
    const adapterAddress = poolsAccountsMap[addressToHex(poolInfo.address).toLowerCase()];

    if (!adapterAddress) {
      throw new Error(`No paymaster adapter configured for pool ${addressToHex(poolInfo.address)}`);
    }

    unwrapResult(await dispatch(verifyRootsThunk({ dataService })));

    const bundlerClient = createPaymasterBundlerClient(bundlerUrl);
    const {
      standard: { maxFeePerGas, maxPriorityFeePerGas },
    } = await getUserOperationGasPrice(bundlerClient);

    const signer = await resolveSigner({
      delegation,
      secretManager,
      chainId,
      entrypointAddress,
      depositIndex: note.deposit,
      withdrawIndex: note.withdraw,
    });

    // The absolute fee (in the pool asset) the adapter forwards to the paymaster:
    // the wei gas cost for native pools, priced into the token via the paymaster's
    // own oracle for ERC20 pools. `feePaid >= paymaster.quoteWeiInToken(maxCost)`
    // holds because both sides read the same oracle and we bound the gas at maxCost.
    const feeFor = async (ethFee: bigint): Promise<bigint> => {
      const fee = isERC20
        ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
        : ethFee;

      if (fee > withdrawnValue) {
        throw new Error("Withdrawal amount too small to cover the sponsored gas fee");
      }

      return fee;
    };

    // With tail calls the adapter must pay the sender (it enforces
    // `recipient == sender` whenever callGasLimit != 0), and the execution phase
    // spends those funds; otherwise the withdrawal pays the user's recipient
    // directly and there is no execution phase.
    const payoutRecipient = tailCalls ? signer.address : addressToHex(recipient);
    const executionGas = tailCalls ? (tailCallsGasEstimate ?? TAIL_CALLS_DEFAULT_GAS) : 0n;

    const buildWithdrawal = (fee: bigint): WithdrawalPayload => ({
      // The adapter is the withdrawal `processooor`: it calls pool.withdraw
      // directly during paymaster validation and enforces `processooor == self`.
      processooor: adapterAddress,
      data: encodeFeeData({
        recipient: payoutRecipient,
        feeRecipient: paymasterAddress,
        fee,
      }),
    });

    const prove = (context: bigint): Promise<WithdrawProveOutput> =>
      dispatch(
        withdrawThunk({ getNextNote, proverFactory, asset, amount: withdrawnValue, recipient, context }),
      ).then(unwrapResult);

    // callGasLimit sizes the execution phase (0 when there are no tail calls).
    const withGas = (base: UserOpGasLimits): UserOpGasLimits => ({ ...base, callGasLimit: executionGas });

    const buildUserOp = async (gas: UserOpGasLimits) => {
      const fee = await feeFor(computeMinimumViableFee(gas, maxFeePerGas));
      const withdrawal = buildWithdrawal(fee);
      const context = BigInt(calculateContext(withdrawal, poolInfo.scope));
      const proof = await prove(context);
      const paymasterData = encodePaymasterData(
        adapterAddress,
        encodePrivacyPoolAdapterData(withdrawal, proof),
      );
      const userOperation = await buildSignedUserOp({
        signer,
        chainId: Number(chainId),
        paymasterAddress,
        paymasterData,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: 0n,
        tailCalls,
      });

      return { proof, userOperation };
    };

    const baselineGas = withGas(reasonableGasUnits(isERC20));
    let { proof, userOperation } = await buildUserOp(baselineGas);

    // Refine gas against the bundler's simulation; re-prove once at the refined
    // fee so the proof matches the tighter limits. Best-effort — on failure we
    // keep the safe baseline.
    const refinedGas = await refineGasWithBundler(bundlerClient, userOperation, entryPointAddress, baselineGas);

    if (refinedGas !== baselineGas) {
      ({ proof, userOperation } = await buildUserOp(withGas(refinedGas)));
    }

    return [
      {
        mode: "paymaster" as const,
        proof,
        poolAddress: poolInfo.address,
        isERC20,
        paymasterAddress,
        entryPointAddress,
        bundlerUrl,
        userOperation,
      },
    ];
  },
);

async function resolveSigner({
  delegation,
  secretManager,
  chainId,
  entrypointAddress,
  depositIndex,
  withdrawIndex,
}: {
  delegation?: DelegationConfig;
  secretManager: ISecretManager;
  chainId: bigint;
  entrypointAddress: bigint;
  depositIndex: number;
  withdrawIndex: number;
}): Promise<DelegatorAccount> {
  if (delegation?.mode === "random") {
    return privateKeyToAccount(generatePrivateKey());
  }

  return privateKeyToAccount(
    await secretManager.deriveEphemeralSigner({ chainId, entrypointAddress, depositIndex, withdrawIndex }),
  );
}

async function refineGasWithBundler(
  bundlerClient: ReturnType<typeof createPaymasterBundlerClient>,
  provisionalUserOp: Awaited<ReturnType<typeof buildSignedUserOp>>,
  entryPointAddress: `0x${string}`,
  baselineGas: UserOpGasLimits,
): Promise<UserOpGasLimits> {
  try {
    const estimated = await estimateUserOperationGas(bundlerClient, provisionalUserOp, entryPointAddress);
    const buffer = (x: bigint) => (x * 12n) / 10n;
    const orBaseline = (e: bigint, b: bigint) => (e > 0n ? buffer(e) : b);

    return {
      callGasLimit: orBaseline(estimated.callGasLimit, baselineGas.callGasLimit),
      verificationGasLimit: orBaseline(estimated.verificationGasLimit, baselineGas.verificationGasLimit),
      preVerificationGas: orBaseline(estimated.preVerificationGas, baselineGas.preVerificationGas),
      paymasterVerificationGasLimit: orBaseline(
        estimated.paymasterVerificationGasLimit,
        baselineGas.paymasterVerificationGasLimit,
      ),
      paymasterPostOpGasLimit: orBaseline(estimated.paymasterPostOpGasLimit, baselineGas.paymasterPostOpGasLimit),
    };
  } catch {
    return baselineGas;
  }
}
