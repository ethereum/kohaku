/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import type { Network } from "@kohaku-eth/plugins";
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
import { assertFeeWithinCap, assertGasLimitsWithinCaps, assertGasPriceWithinCaps } from "../../paymaster/fee-caps";
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
import { WithdrawProveOutput, WithdrawThunkParams, withdrawThunk } from "./withdrawThunk";

// A BIP-32 path: `m` followed by one or more `/index` segments, each optionally
// hardened with a trailing apostrophe (e.g. m/44'/60'/0'/0/0).
const BIP32_PATH = /^m(\/\d+'?)+$/;

function assertValidDelegatorPath(path: string): void {
  if (!BIP32_PATH.test(path)) {
    throw new Error(`Invalid delegation path "${path}": expected a BIP-32 path like m/44'/60'/0'/0/0`);
  }
}

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
  /**
   * Where the paymaster sends the gas-overcharge refund in postOp. Defaults to
   * `recipient`; set it to route the refund elsewhere (e.g. a payer/change address so
   * the recipient nets exactly its payout).
   */
  refundRecipient?: Address;
  /** Cap on the sponsored fee as a share of the withdrawn amount (bps). Defaults to `DEFAULT_PAYMASTER_MAX_FEE_BPS`. */
  maxFeeBPS?: bigint;
  /** Host network; bundler JSON-RPC goes through its `fetch`. */
  network?: Network;
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
      refundRecipient: refundRecipientOverride,
      maxFeeBPS,
      network,
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

    // Roots were already verified against chain by the sync() that the plugin runs
    // immediately before building this withdrawal (buildUnshield → sync → verifyRoots,
    // on the same unchanged state). Re-verifying here repeats 15 on-chain reads for no
    // benefit, so it's intentionally omitted.

    // The bundler's gas price is only accepted within caps derived from the chain's own
    // fee market: the baseline userOp below is signed, proved, and sent to the bundler
    // for estimation before the user confirms, so the bundler could land it as-is.
    const bundlerClient = createPaymasterBundlerClient(bundlerUrl, network);
    const [{ standard: gasPrice }, feeReference] = await Promise.all([
      getUserOperationGasPrice(bundlerClient),
      dataService.getGasFeeReference(),
    ]);

    assertGasPriceWithinCaps(gasPrice, feeReference);

    const { maxFeePerGas, maxPriorityFeePerGas } = gasPrice;

    const signer = await resolveSigner({
      delegation,
      secretManager,
      chainId,
      entrypointAddress,
      depositIndex: sponsoring!.note.deposit,
      withdrawIndex: sponsoring!.note.withdraw,
    });

    // A wallet-path delegator can be a reused EOA with a nonzero transaction
    // count, which the 7702 authorization must bind to. Ephemeral/random senders
    // are fresh single-use EOAs (nonce 0), so we skip the RPC and let the auth
    // default to 0 — keeping that hot path RPC-free.
    const authorizationNonce =
      delegation?.mode === "deterministic" && delegation.path
        ? BigInt(await dataService.getTransactionCount(signer.address))
        : undefined;

    const payoutRecipient = hasExecutionPhase ? signer.address : addressToHex(recipient);

    // Where the paymaster sends the gas-overcharge refund in postOp: the caller-supplied
    // `refundRecipient`, else the real recipient — so the user gets their gas money back
    // at the address they designated instead of it being stranded on the ephemeral sender
    // (`payoutRecipient` is the sender whenever there is an execution phase). The
    // paymaster's postOp refund is failure-safe, so an awkward target can't brick the op.
    const refundRecipient = addressToHex(refundRecipientOverride ?? recipient);

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

      // The fee committed in the proof bounds what a bundler can take from it.
      assertFeeWithinCap(fee, totalWithdrawn, maxFeeBPS);

      return fee;
    };

    const baselineGas = hasExecutionPhase
      ? reasonableGasUnitsForBatch(isERC20, directNotes.length, tailCalls != null, tailCallsGasEstimate)
      : { ...reasonableGasUnits(isERC20), callGasLimit: 0n };
    // Checked before anything is proved or signed.
    const baselineFee = await feeFor(computeMinimumViableFee(baselineGas, maxFeePerGas));

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

    const buildUserOp = async (gas: UserOpGasLimits, fee: bigint) => {
      const withdrawal: WithdrawalPayload = {
        processooor: adapterAddress,
        // `recipient` is the validation-phase payout target (the sender when an
        // execution phase exists); `refundRecipient` carries the postOp gas-overcharge
        // refund to the real recipient (see its definition above).
        data: encodeFeeData({
          recipient: payoutRecipient,
          feeRecipient: paymasterAddress,
          fee,
          refundRecipient,
        }),
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
        authorizationNonce,
        tailCalls: hasExecutionPhase ? executionCalls(fee) : undefined,
      });

      return { proof, userOperation };
    };

    let fee = baselineFee;
    let { proof, userOperation } = await buildUserOp(baselineGas, fee);

    // Refine gas against the bundler; re-prove once at the refined fee. If estimation
    // fails the baseline is kept; an estimate above the caps throws.
    const refinedGas = await refineGasWithBundler(bundlerClient, userOperation, entryPointAddress, baselineGas);

    if (refinedGas !== baselineGas) {
      fee = await feeFor(computeMinimumViableFee(refinedGas, maxFeePerGas));
      ({ proof, userOperation } = await buildUserOp(refinedGas, fee));
    }

    return [
      {
        mode: "paymaster" as const,
        proof,
        poolAddress: poolInfo.address,
        isERC20,
        withdrawnValue: totalWithdrawn,
        fee,
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

  if (delegation?.mode === "deterministic" && delegation.path) {
    assertValidDelegatorPath(delegation.path);

    return privateKeyToAccount(await secretManager.deriveDelegatorSigner({ path: delegation.path }));
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
  let estimated: UserOpGasLimits;

  try {
    estimated = await estimateUserOperationGas(bundlerClient, provisionalUserOp, entryPointAddress);
  } catch {
    return baselineGas;
  }

  const buffer = (x: bigint) => (x * 12n) / 10n;
  const orBaseline = (e: bigint, b: bigint) => (e > 0n ? buffer(e) : b);
  const refined: UserOpGasLimits = {
    // Keep our computed callGasLimit (0 without an execution phase — a nonzero value
    // would trip the adapter's `recipient != sender` check).
    callGasLimit: baselineGas.callGasLimit,
    verificationGasLimit: orBaseline(estimated.verificationGasLimit, baselineGas.verificationGasLimit),
    preVerificationGas: orBaseline(estimated.preVerificationGas, baselineGas.preVerificationGas),
    paymasterVerificationGasLimit: orBaseline(
      estimated.paymasterVerificationGasLimit,
      baselineGas.paymasterVerificationGasLimit,
    ),
    paymasterPostOpGasLimit: orBaseline(estimated.paymasterPostOpGasLimit, baselineGas.paymasterPostOpGasLimit),
  };

  // preVerificationGas is charged in full and every limit raises the fee, so the
  // bundler's numbers are only accepted within a bounded margin over our baseline.
  assertGasLimitsWithinCaps(refined, baselineGas);

  return refined;
}
