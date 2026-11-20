/* eslint-disable max-lines */
import { executionAccount, executionSender, externalAccountSigner, requiresAccountSimulation, executionGasBaseline, prepareExecutionAccount } from '../../account/execution-account';
import type { MerkleTreeBuilder } from "../../utils/proof.util";
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import type { Network } from "@kohaku-eth/plugins";
import type { EthereumProvider } from "@kohaku-eth/provider";
import { TxData } from "@kohaku-eth/provider";
import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { encodeFunctionData, erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ISecretManager } from "../../account/keys";
import { verifiedExternalDelegator } from '../../account/external-delegator';
import { E_ADDRESS } from "../../config";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { DelegationConfig, DelegatorAccount, SerializedUserOperation, UserOpGasLimits } from "../../interfaces/user-ops.interface";
import { computeMinimumViableFee, paymasterBaselineGas } from "../../paymaster/fee";
import { assertGasLimitsWithinBounds, assertGasPriceWithinBounds, readGasFeeReference, type PaymasterGasLimits } from "../../paymaster/gas-bounds";
import { encodeFeeData, encodePaymasterData, encodePoolWithdraw, encodePrivacyPoolAdapterData } from "../../paymaster/adapter-data";
import {
  buildSignedUserOp,
  buildSimulationUserOp,
  createPaymasterBundlerClient,
  estimateUserOperationGas,
  getUserOperationGasPrice,
} from "../../paymaster/utils";
import { verifierOverrides, type StateOverrides } from "../../paymaster/simulation";
import { resolveTailCalls } from "../../paymaster/tail-calls";
import { fundObfuscatedBatchSponsor } from "../../withdrawal/batch-plan";
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
  merkleTreeBuilder?: MerkleTreeBuilder;
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
  /** Internal allocation, resolved once by the state manager before proof generation. */
  notesToSpend?: NoteToSpend[];
  /**
   * Where the paymaster sends the gas-overcharge refund in postOp. Defaults to
   * `recipient`; set it to route the refund elsewhere (e.g. a payer/change address so
   * the recipient nets exactly its payout).
   */
  refundRecipient?: Address;
  maxGasLimits?: PaymasterGasLimits;
  provider?: EthereumProvider;
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
      merkleTreeBuilder,
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
      notesToSpend: plannedNotes,
      refundRecipient: refundRecipientOverride,
      maxGasLimits,
      provider,
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

    // Reuse the protected allocation, or fall back to legacy full-note selection.
    const notesToSpend = (plannedNotes ?? (batch ? selectBatchNotes(state, asset, amount) : selectSingleNote(state, asset, amount)))
      .map(entry => ({ ...entry }));
    const totalWithdrawn = notesToSpend.reduce((sum, n) => sum + n.withdrawnValue, 0n);
    // Largest note (first) is sponsored — it pays the fee; the rest run in the
    // execution phase. An execution phase exists when consolidating extra notes or
    // running tail calls; then the adapter pays the sender (it enforces
    // `recipient == sender` whenever callGasLimit != 0).
    const [sponsoring, ...directNotes] = notesToSpend;
    const hasExecutionPhase = directNotes.length > 0 || tailCalls != null;

    if (delegation?.mode === "random" && notesToSpend.length > 0 && hasExecutionPhase && delegation.allowUnsafeRandomExecution !== true) {
      throw new Error("Random Privacy Pools sender may permanently strand funds with multiple notes or tailCalls; set delegation.allowUnsafeRandomExecution: true to accept this risk.");
    }

    // Roots were already verified against chain by the sync() that the plugin runs
    // immediately before building this withdrawal (buildUnshield → sync → verifyRoots,
    // on the same unchanged state). Re-verifying here repeats 15 on-chain reads for no
    // benefit, so it's intentionally omitted. If that sync could not refresh the ASP
    // tree, withdrawThunk refuses to prove.

    const bundlerClient = createPaymasterBundlerClient(bundlerUrl, network);
    const [{ standard: price }, reference] = await Promise.all([
      getUserOperationGasPrice(bundlerClient),
      readGasFeeReference(provider),
    ]);

    assertGasPriceWithinBounds(price, reference);
    const { maxFeePerGas, maxPriorityFeePerGas } = price;

    executionAccount(delegation);
    let signer = await resolveSigner({
      delegation,
      secretManager,
      chainId,
      entrypointAddress,
      depositIndex: sponsoring!.note.deposit,
      withdrawIndex: sponsoring!.note.withdraw,
    });

    // A wallet-path or external delegator can be a reused EOA with a nonzero transaction
    // count, which the 7702 authorization must bind to. Ephemeral/random senders
    // are normally fresh; the shared preflight below checks that assumption and
    // reads the current EntryPoint/native nonces before signing.
    const knownNativeNonce =
      delegation?.mode !== "smart-account" && (delegation?.mode === "external" || (delegation?.mode === "deterministic" && delegation.path) || delegation?.nonce !== undefined || !!delegation?.implementation)
        ? BigInt(await dataService.getTransactionCount(signer.address))
        : undefined;

    const preparedAccount = await prepareExecutionAccount(delegation, signer, provider, entryPointAddress, knownNativeNonce);
    const { account: accountConfig, nonce: userOpNonce, authorizationNonce } = preparedAccount;

    if (delegation?.mode === 'external' || delegation?.mode === 'smart-account') {
      signer = verifiedExternalDelegator(signer, { chainId: Number(chainId), nonce: authorizationNonce ?? 0n, entryPointAddress, paymasterAddress,
        implementation: delegation.mode === 'external' ? delegation.implementation : undefined,
        sender: executionSender(delegation, signer), userOpNonce, smartAccount: delegation.mode === 'smart-account',
        factory: accountConfig.kind === 'simple-account' ? accountConfig.factory : undefined,
      });
    }

    const sender = executionSender(delegation, signer);
    const payoutRecipient = hasExecutionPhase ? sender : addressToHex(recipient);

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
    // Quotes are memoized so the final build commits to the fee its gas was simulated with.
    const quotes = new Map<bigint, Promise<bigint>>();
    const feeFor = async (ethFee: bigint): Promise<bigint> => {
      if (isERC20 && !quotes.has(ethFee)) quotes.set(ethFee, dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee));

      const fee = isERC20 ? await quotes.get(ethFee)! : ethFee;

      if (plannedNotes) fundObfuscatedBatchSponsor(notesToSpend, fee);

      if (fee > sponsoring!.withdrawnValue) {
        throw new Error("Withdrawal amount too small to cover the sponsored gas fee");
      }

      return fee;
    };

    // Prove one note against the current root, bound to `withdrawal` via its context.
    // `simulation` returns a dummy proof for gas estimation (see withdrawThunk).
    const proveNote = (toSpend: NoteToSpend, withdrawal: WithdrawalPayload, simulation = false): Promise<WithdrawProveOutput> =>
      dispatch(
        withdrawThunk({
          getNextNote,
          proverFactory,
          merkleTreeBuilder,
          asset,
          recipient,
          note: toSpend.note,
          amount: toSpend.withdrawnValue,
          context: BigInt(calculateContext(withdrawal, poolInfo.scope)),
          simulation,
        }),
      ).then(unwrapResult);

    // Estimation simulates dummy proofs, which only these verifier overrides accept.
    const poolHex = addressToHex(poolInfo.address);
    const stateOverrides: StateOverrides = await verifierOverrides(provider!, [poolHex]);

    // Extra notes: direct pool.withdraw calls (processooor = sender, no fee), each
    // paying the sender. A real proof here could be submitted on its own, so
    // estimation uses dummy-proof calls and the real ones are proved once at the end.
    const directWithdrawCalls = async (simulation: boolean): Promise<TxData[]> => {
      const calls: TxData[] = [];

      for (const directNote of directNotes) {
        if (directNote.withdrawnValue === 0n) continue;

        const withdrawal: WithdrawalPayload = { processooor: sender, data: "0x" };
        const proof = await proveNote(directNote, withdrawal, simulation);

        calls.push({ to: poolHex, value: 0n, data: encodePoolWithdraw(withdrawal, proof) });
      }

      return calls;
    };

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

    // The caller's tail calls, resolved once: every build signs or estimates
    // these same calls.
    const resolvedTailCalls = tailCalls ? await resolveTailCalls(tailCalls, sender) : undefined;

    // callData order: direct withdraws first (they fund the sender), then the
    // caller's tail calls or the synthesized forward.
    const executionCalls = (fee: bigint, directCalls: TxData[]) => async (): Promise<TxData[]> => [
      ...directCalls,
      ...(resolvedTailCalls ?? (addressToHex(recipient).toLowerCase() === sender.toLowerCase() ? [] : [forwardCall(fee)])),
    ];

    const baselineGas = executionGasBaseline(accountConfig,
      paymasterBaselineGas(isERC20, notesToSpend.length, tailCalls != null, tailCallsGasEstimate));

    assertGasLimitsWithinBounds(baselineGas, baselineGas, undefined, maxGasLimits);

    // `simulation` builds the estimation payload: dummy proofs and signatures that
    // the bundler cannot submit. Only the final build proves and signs.
    const buildUserOp = async (gas: UserOpGasLimits, simulation: boolean) => {
      const fee = await feeFor(computeMinimumViableFee(gas, maxFeePerGas));
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
      const proof = await proveNote(sponsoring!, withdrawal, simulation);
      const paymasterData = encodePaymasterData(adapterAddress, encodePrivacyPoolAdapterData(withdrawal, proof));
      // Batched notes are proved for real only in the final build.
      const directCalls = await directWithdrawCalls(simulation);
      const params = {
        signer,
        executionAccount: accountConfig,
        chainId: Number(chainId),
        paymasterAddress,
        paymasterData,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: userOpNonce,
        authorizationNonce,
        tailCalls: hasExecutionPhase ? executionCalls(fee, directCalls) : undefined,
      };
      const { userOperation, userOpHash } = simulation
        ? { userOperation: await buildSimulationUserOp(params), userOpHash: undefined }
        : await buildSignedUserOp(params);

      assertGasLimitsWithinBounds(gas, baselineGas, userOperation, maxGasLimits);

      return { proof, userOperation, userOpHash, fee };
    };

    // What makes bundler gas estimation mandatory, named in its errors. External
    // signers, and withdrawals that run calls after the payout reaches the
    // sender, require successful estimation at the final limits. Undefined
    // (derived keys and nothing runs after the payout) allows the baseline fallback.
    let estimationRequiredBy: string | undefined;

    if (requiresAccountSimulation(delegation)) estimationRequiredBy = 'External Privacy Pools signing';
    else if (hasExecutionPhase) estimationRequiredBy = 'A Privacy Pools withdrawal that runs calls after the payout';

    const provisional = await buildUserOp(baselineGas, true);
    const refinedGas = await refineGasWithBundler(
      bundlerClient, provisional.userOperation, entryPointAddress, stateOverrides, baselineGas, maxGasLimits, estimationRequiredBy,
    );

    if (estimationRequiredBy) {
      const simulated = refinedGas === baselineGas ? provisional.userOperation : (await buildUserOp(refinedGas, true)).userOperation;
      const finalGas = await estimateUserOperationGas(bundlerClient, simulated, entryPointAddress, stateOverrides);

      assertGasLimitsWithinBounds(finalGas, baselineGas, simulated, maxGasLimits);
      const fields = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const;

      const hasCalls = simulated.callData !== '0x';
      // The refined limits the final estimate must fit. Validation-only withdrawals
      // keep execution gas zero even when the bundler reports a search estimate.
      const refinedGasFields = fields.filter(field => field !== 'callGasLimit' || hasCalls);

      const estimateMissingGas = finalGas.verificationGasLimit <= 0n || finalGas.preVerificationGas <= 0n || (hasCalls && finalGas.callGasLimit <= 0n);
      const estimateHasNegativeGas = fields.some(field => finalGas[field] < 0n);
      const estimateExceedsRefinedGas = refinedGasFields.some(field => finalGas[field] > BigInt(simulated[field]!));

      if (estimateMissingGas || estimateHasNegativeGas || estimateExceedsRefinedGas) {
        throw new Error('Privacy Pools UserOperation gas requirements changed after refinement. Prepare a new withdrawal.');
      }
    }

    const { proof, userOperation, userOpHash, fee } = await buildUserOp(refinedGas, false);

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
        userOpHash,
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
  if (delegation?.mode === "external" || delegation?.mode === "smart-account") return externalAccountSigner(delegation);

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
  provisionalUserOp: SerializedUserOperation,
  entryPointAddress: `0x${string}`,
  stateOverrides: StateOverrides,
  baselineGas: UserOpGasLimits,
  maxGasLimits?: PaymasterGasLimits,
  /** What makes bundler gas estimation mandatory, named in its errors; undefined allows the baseline fallback. */
  estimationRequiredBy?: string,
): Promise<UserOpGasLimits> {
  let estimated: UserOpGasLimits;

  try {
    estimated = await estimateUserOperationGas(bundlerClient, provisionalUserOp, entryPointAddress, stateOverrides);
  } catch (cause) {
    if (estimationRequiredBy) throw new Error(`${estimationRequiredBy} requires successful bundler gas estimation.`, { cause });

    return baselineGas;
  }

  // Calls signed with an unverified execution budget can fail after the payout
  // reaches the sender, leaving the funds there.
  const hasCalls = provisionalUserOp.callData !== '0x';

  if (hasCalls && estimationRequiredBy && estimated.callGasLimit <= 0n) {
    throw new Error(`${estimationRequiredBy} requires a positive bundler callGasLimit estimate.`);
  }

  const buffer = (x: bigint) => (x * 12n + 9n) / 10n;
  const orBaseline = (e: bigint, b: bigint) => (e > 0n ? buffer(e) : b);
  const refined: UserOpGasLimits = {
    // Only a withdrawal with no execution phase must retain a zero limit
    // (`tailCallsGas` rejects a zero tail budget).
    callGasLimit: baselineGas.callGasLimit === 0n ? 0n : orBaseline(estimated.callGasLimit, baselineGas.callGasLimit),
    verificationGasLimit: orBaseline(estimated.verificationGasLimit, baselineGas.verificationGasLimit),
    preVerificationGas: orBaseline(estimated.preVerificationGas, baselineGas.preVerificationGas),
    paymasterVerificationGasLimit: orBaseline(
      estimated.paymasterVerificationGasLimit,
      baselineGas.paymasterVerificationGasLimit,
    ),
    paymasterPostOpGasLimit: orBaseline(estimated.paymasterPostOpGasLimit, baselineGas.paymasterPostOpGasLimit),
  };

  // A bounds violation must fail, never masquerade as unavailable estimation.
  assertGasLimitsWithinBounds(refined, baselineGas, provisionalUserOp, maxGasLimits);

  return refined;
}
