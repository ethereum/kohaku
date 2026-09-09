/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { TxData } from "@kohaku-eth/provider";
import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { encodeFunctionData, erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ISecretManager } from "../../account/keys";
import { E_ADDRESS } from "../../config";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { DelegationConfig, DelegatorAccount, UserOpGasLimits } from "../../interfaces/user-ops.interface";
import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch } from "../../paymaster/fee";
import { encodeFeeData, encodePaymasterData, encodePoolWithdraw, encodePrivacyPoolAdapterData } from "../../paymaster/adapter-data";
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
import { getNotesToSpendSelector, getNoteSelector, NoteToSpend } from "../selectors/notes.selector";
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
  /**
   * Opt in to consolidating multiple approved notes to reach `amount` in one userOp.
   * The largest note is sponsored; the rest run as direct pool.withdraw calls in the
   * execution phase and the consolidated balance is forwarded to `recipient`.
   */
  batch?: boolean;
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
      batch,
    },
    { getState, dispatch },
  ) => {
    const state = getState();
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    const poolInfo = poolFromAssetSelector(state, asset);

    if (!poolInfo) throw new Error(`No pool found for asset ${asset}`);

    const isERC20 = poolInfo.asset !== BigInt(E_ADDRESS);

    const { bundlerUrl, entryPointAddress, paymasterAddress, poolsAccountsMap } = paymasterConfig;
    const adapterAddress = poolsAccountsMap[addressToHex(poolInfo.address).toLowerCase()];

    if (!adapterAddress) {
      throw new Error(`No paymaster adapter configured for pool ${addressToHex(poolInfo.address)}`);
    }

    // Select the note(s): a batch consolidates the minimal set of approved notes to
    // reach `amount`; otherwise the single smallest-sufficient note.
    const notesToSpend = batch ? selectBatchNotes(state, asset, amount) : selectSingleNote(state, asset, amount);
    const totalWithdrawn = notesToSpend.reduce((sum, n) => sum + n.withdrawnValue, 0n);
    // Largest note (first) is sponsored — it pays the fee; the rest run in the
    // execution phase. An execution phase exists when consolidating extra notes or
    // running tail calls; then the adapter pays the sender (it enforces
    // `recipient == sender` whenever callGasLimit != 0).
    const [sponsoring, ...directNotes] = notesToSpend;
    const hasExecutionPhase = directNotes.length > 0 || tailCalls != null;

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
      depositIndex: sponsoring!.note.deposit,
      withdrawIndex: sponsoring!.note.withdraw,
    });

    const payoutRecipient = hasExecutionPhase ? signer.address : addressToHex(recipient);

    // The absolute fee (in the pool asset), taken from the sponsoring note's payout:
    // the wei gas cost for native pools, priced into the token via the paymaster's own
    // oracle for ERC20. `feePaid >= paymaster.quoteWeiInToken(maxCost)` holds by
    // construction (same oracle, gas bounded at maxCost).
    const feeFor = async (ethFee: bigint): Promise<bigint> => {
      const fee = isERC20
        ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
        : ethFee;

      if (fee > sponsoring!.withdrawnValue) {
        throw new Error("Withdrawal amount too small to cover the sponsored gas fee");
      }

      return fee;
    };

    // Prove one note against the current root, bound to `withdrawal` via its context.
    const proveNote = (toSpend: NoteToSpend, withdrawal: WithdrawalPayload): Promise<WithdrawProveOutput> =>
      dispatch(
        withdrawThunk({
          getNextNote,
          proverFactory,
          asset,
          recipient,
          note: toSpend.note,
          amount: toSpend.withdrawnValue,
          context: BigInt(calculateContext(withdrawal, poolInfo.scope)),
        }),
      ).then(unwrapResult);

    // Extra notes: direct pool.withdraw calls (processooor = sender, no fee), each
    // paying the sender. Proved once — only the sponsoring note's fee changes.
    const poolHex = addressToHex(poolInfo.address);
    const directWithdrawCalls: TxData[] = [];

    for (const directNote of directNotes) {
      const withdrawal: WithdrawalPayload = { processooor: signer.address, data: "0x" };
      const proof = await proveNote(directNote, withdrawal);

      directWithdrawCalls.push({ to: poolHex, value: 0n, data: encodePoolWithdraw(withdrawal, proof) });
    }

    // Forward the consolidated balance (minus fee) to the recipient when the caller
    // supplied no tail calls.
    const forwardCall = (fee: bigint): TxData => {
      const amountOut = totalWithdrawn - fee;

      if (isERC20) {
        return {
          to: addressToHex(poolInfo.asset),
          value: 0n,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [addressToHex(recipient), amountOut] }),
        };
      }

      return { to: addressToHex(recipient), value: amountOut, data: "0x" };
    };

    // callData order: direct withdraws first (they fund the sender), then the
    // caller's tail calls or the synthesized forward.
    const executionCalls = (fee: bigint) => async (): Promise<TxData[]> => [
      ...directWithdrawCalls,
      ...(tailCalls ? await tailCalls(signer.address) : [forwardCall(fee)]),
    ];

    const baselineGas = hasExecutionPhase
      ? reasonableGasUnitsForBatch(isERC20, directNotes.length, tailCalls != null, tailCallsGasEstimate)
      : { ...reasonableGasUnits(isERC20), callGasLimit: 0n };

    // Keep our computed callGasLimit after bundler refinement (0 without an execution
    // phase — a nonzero value would trip the adapter's `recipient != sender` check).
    const withGas = (base: UserOpGasLimits): UserOpGasLimits => ({ ...base, callGasLimit: baselineGas.callGasLimit });

    const buildUserOp = async (gas: UserOpGasLimits) => {
      const fee = await feeFor(computeMinimumViableFee(gas, maxFeePerGas));
      const withdrawal: WithdrawalPayload = {
        processooor: adapterAddress,
        data: encodeFeeData({ recipient: payoutRecipient, feeRecipient: paymasterAddress, fee }),
      };
      const proof = await proveNote(sponsoring!, withdrawal);
      const paymasterData = encodePaymasterData(adapterAddress, encodePrivacyPoolAdapterData(withdrawal, proof));
      const userOperation = await buildSignedUserOp({
        signer,
        chainId: Number(chainId),
        paymasterAddress,
        paymasterData,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: 0n,
        tailCalls: hasExecutionPhase ? executionCalls(fee) : undefined,
      });

      return { proof, userOperation };
    };

    let { proof, userOperation } = await buildUserOp(baselineGas);

    // Refine gas against the bundler; re-prove once at the refined fee. Best-effort —
    // on failure the safe baseline is kept.
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

function selectSingleNote(state: RootState, asset: Address, amount?: bigint): NoteToSpend[] {
  const note = getNoteSelector(state, asset, amount ?? 0n);

  if (!note) throw new Error("No note with sufficient balance for withdrawal");

  const withdrawnValue = amount ?? note.balance;

  if (withdrawnValue <= 0n) throw new Error("Withdrawal amount must be greater than zero");

  return [{ note, withdrawnValue }];
}

function selectBatchNotes(state: RootState, asset: Address, amount?: bigint): NoteToSpend[] {
  if (amount == null) throw new Error("Batch withdrawal requires an explicit amount");

  if (amount <= 0n) throw new Error("Withdrawal amount must be greater than zero");

  return getNotesToSpendSelector(state, asset, amount);
}

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
