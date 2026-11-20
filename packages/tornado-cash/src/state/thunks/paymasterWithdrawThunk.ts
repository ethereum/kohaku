import { executionAccount, executionSender, externalAccountSigner, requiresAccountSimulation, executionGasBaseline, prepareExecutionAccount } from '../../account/execution-account';
/* eslint-disable max-lines */
import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { AccountId } from "@kohaku-eth/plugins";
import { createTx, TxData } from "@kohaku-eth/provider";
import type { EthereumProvider } from "@kohaku-eth/provider";
import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi } from "viem";

import { buildEstimatedTornadoUserOp } from "../../paymaster/estimate";
import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch } from "../../paymaster/fee";
import { encodePoolPaymasterData, resolvePoolPaymaster } from "../../paymaster/config";
import { buildSignedTornadoUserOp, buildSimulationTornadoUserOp, createPaymasterBundlerClient, estimateUserOperationGas, getUserOperationGasPrice, networkFromBundlerPost, serializedUserOperationHash, type BundlerPost } from "../../paymaster/utils";
import { verifierOverrides } from "../../paymaster/simulation";
import { resolveTailCalls } from "../../paymaster/tail-calls";
import { assertGasLimitsWithinBounds, assertGasPriceWithinBounds, readGasFeeReference, type PaymasterGasLimits } from "../../paymaster/gas-bounds";
import { poolAbi } from "../../data/abis/pool.abi";
import { addressToHex } from "../../utils";
import { GasEstimationPolicy, UserOpGasLimits } from "../../interfaces/user-ops.interface";
import { DelegatorAccount } from "../../account/delegation.interface";
import { verifiedExternalDelegator } from '../../account/external-delegator';
import { DelegationConfig, IChainsPaymastersConfig, IWithdrawalPayload } from "../../plugin/interfaces/protocol-params.interface";
import { instanceRegistryInfoSelector, poolsSelector } from "../selectors/slices.selectors";
import { RootState } from "../store";
import { verifyRootsThunk } from "./verifyRootsThunk";
import { WithdrawalProofsThunkParams, withdrawalsProofThunk } from "./withdrawalsProofThunk";
import { getWithdrawableDepositsSelector } from "../selectors/withdrawals.selector";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";

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
  tailCallsGasEstimate?: bigint;
  gasEstimationPolicy?: GasEstimationPolicy;
  executionGasRetry?: boolean;
  maxGasLimits?: PaymasterGasLimits;
  provider?: EthereumProvider;
  bundlerPost?: BundlerPost;
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
  tailCallsGasEstimate,
  gasEstimationPolicy = 'best-effort',
  executionGasRetry = false,
  maxGasLimits,
  provider,
  bundlerPost,
  ...rest
}, { getState, dispatch }) => {
  if (gasEstimationPolicy !== 'required' && gasEstimationPolicy !== 'best-effort') {
    throw new Error('Unknown Tornado gas estimation policy.');
  }

  if (typeof executionGasRetry !== 'boolean') {
    throw new Error('Tornado executionGasRetry must be a boolean.');
  }

  const executionGasRetryLimit = executionGasRetry ? maxGasLimits?.callGasLimit : undefined;

  if (executionGasRetry && (typeof executionGasRetryLimit !== 'bigint' || executionGasRetryLimit <= 0n)) {
    throw new Error('Tornado executionGasRetry requires a positive maxGasLimits.callGasLimit ceiling.');
  }

  const state = getState();
  const { chainId: rawChainId } = instanceRegistryInfoSelector(state);
  const chainId = Number(rawChainId);
  const deposits = getWithdrawableDepositsSelector(state, assetAddress, amount);

  // Without tail calls, one note pays and refunds the requested recipient
  // directly. Explicit tail calls opt into sender-bound sponsorship and execution
  // for either account family, even when spending only one note.
  const validationOnly = deposits.length === 1 && tailCalls == null;

  if (delegation?.mode === 'random' && deposits.length > 0 && !validationOnly && delegation.allowUnsafeRandomExecution !== true) {
    throw new Error('Random Tornado sender may permanently strand funds with multiple notes or tailCalls; set delegation.allowUnsafeRandomExecution: true to accept this risk.');
  }

  const poolsToWithdrawFrom = [...new Set(deposits.map((d) => d.pool))];

  const pools = poolsSelector(state);
  const poolInfo = pools.get(deposits[0]!.pool);

  if (!poolInfo) throw new Error(`No pool found for asset ${assetAddress}`);

  const {
    bundlerUrl,
    entryPointAddress,
  } = paymasterConfig[chainId]!;
  const paymasterAddress = resolvePoolPaymaster(paymasterConfig[chainId]!, deposits[0]!.pool);

  unwrapResult(
    await dispatch(verifyRootsThunk({
      dataService,
      onlyThesePools: poolsToWithdrawFrom
    }))
  );

  const bundlerClient = createPaymasterBundlerClient(bundlerUrl, bundlerPost && networkFromBundlerPost(bundlerPost));

  const [{ standard: price }, reference] = await Promise.all([
    getUserOperationGasPrice(bundlerClient),
    readGasFeeReference(provider),
  ]);

  assertGasPriceWithinBounds(price, reference);
  const { maxFeePerGas, maxPriorityFeePerGas } = price;

  // The relayer address in the sponsoring proof is the paymaster — it receives
  // the fee that reimburses the sponsored gas for the whole userOp.
  const relayerAddress = BigInt(paymasterAddress) as Address;
  const bigintChainId = await dataService.getChainId();
  const { recipient: originalRecipient, ...restWithoutRecipient } = rest;

  // Price an ETH-denominated fee in the pool asset via the paymaster's own
  // oracle (same pool/TWAP it enforces in validation), so feePaid >= required
  // holds by construction. Native pools pay the fee directly in ETH.
  // Memoized so the final build commits to the fee its gas was simulated with.
  const quotes = new Map<bigint, Promise<bigint>>();
  const quoteFee = (ethFee: bigint): Promise<bigint> => {
    if (!poolInfo.isERC20) return Promise.resolve(ethFee);

    if (!quotes.has(ethFee)) quotes.set(ethFee, dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee));

    return quotes.get(ethFee)!;
  };

  // `simulation` returns a dummy proof for gas estimation (see withdrawalsProofThunk).
  const prove = async (
    deposit: (typeof deposits)[number],
    recipient: Address,
    relayer: Address,
    depositFee: bigint,
    simulation = false,
  ): Promise<TornadoProveOutput> =>
    unwrapResult(await dispatch(withdrawalsProofThunk({
      ...restWithoutRecipient,
      recipient,
      deposit,
      relayerAddress: relayer,
      fee: depositFee,
      simulation,
    })));

  // The paymaster decodes the pool and proof itself.
  const buildPaymasterData = (poolAddress: bigint, proof: TornadoProveOutput) =>
    encodePoolPaymasterData(poolAddress, proof);

  const ephemeralSigner = async (deposit: (typeof deposits)[number]): Promise<DelegatorAccount> => {
    if (deposit.kind === 'legacy') {
      return privateKeyToAccount(
        await secretManager.deriveLegacyEphemeralSigner({ nullifier: deposit.nullifier }),
      );
    }

    if (deposit.kind === 'signature') {
      return privateKeyToAccount(
        await secretManager.deriveSignatureEphemeralSigner({
          nonce: deposit.nonce,
          chainId: bigintChainId,
          poolAddress: deposit.pool,
        }),
      );
    }

    return privateKeyToAccount(
      await secretManager.deriveEphemeralSigner({
        depositIndex: deposit.depositIndex,
        chainId: bigintChainId,
        poolAddress: deposit.pool,
      }),
    );
  };

  // The shared delegator owns the userOp. Execution-phase withdrawals land
  // here before tailCalls or synthesized forwarding; postOp refunds can remain
  // here too. It is recoverable by default; `random` opts out.
  const resolveBatchDelegator = async (): Promise<DelegatorAccount> => {
    if (delegation?.mode === 'external' || delegation?.mode === 'smart-account') return externalAccountSigner(delegation);

    if (delegation?.mode === 'random') return privateKeyToAccount(generatePrivateKey());
    
    if (delegation?.mode === 'deterministic' && delegation.path) {
      assertValidDelegatorPath(delegation.path);

      return privateKeyToAccount(await secretManager.deriveDelegatorSigner({ path: delegation.path }));
    }

    return ephemeralSigner(deposits[0]!);
  };

  // Preserve zero execution gas/calldata for direct single notes with either account
  // family, including eligible fallback when a bundler substitutes a search limit.
  // Fallback can still be rejected or miss a postOp refund. Gas/fee bounds
  // remain enforced; simulation availability does not change payout custody.
  const allowFallback = delegation?.allowUsed !== true && delegation?.mode !== 'smart-account' && !delegation?.implementation && (delegation?.nonce ?? 0n) === 0n && gasEstimationPolicy === 'best-effort' && tailCalls == null &&
    (chainId === 1 || chainId === 11155111) &&
    (validationOnly || (delegation?.mode !== 'random' && !requiresAccountSimulation(delegation)));

  executionAccount(delegation);
  let signer = await resolveBatchDelegator();
  const senderAddress = BigInt(executionSender(delegation, signer)) as Address;

  // Explicit wallet-path and external senders may have prior EOA transactions.
  // Note-derived and random senders require allowUsed to reuse current state.
  // Native authorization and EntryPoint nonces are independent.
  const knownNativeNonce = delegation?.mode !== 'smart-account' && (delegation?.mode === 'external' || (delegation?.mode === 'deterministic' && delegation.path) || delegation?.nonce !== undefined || !!delegation?.implementation)
    ? BigInt(await dataService.getAccountNonce(senderAddress))
    : undefined;

  const preparedAccount = await prepareExecutionAccount(delegation, signer, provider, entryPointAddress, knownNativeNonce);
  const { account: accountConfig, nonce: userOpNonce, authorizationNonce } = preparedAccount;

  if (delegation?.mode === 'external' || delegation?.mode === 'smart-account') {
    signer = verifiedExternalDelegator(signer, chainId, authorizationNonce ?? 0n, {
      implementation: delegation.mode === 'external' ? delegation.implementation : undefined,
      sender: executionSender(delegation, signer), userOpNonce, smartAccount: delegation.mode === 'smart-account',
    });
  }

  const sponsoringDeposit = deposits[0]!;
  const directDeposits = deposits.slice(1);

  // Estimation simulates dummy proofs, which only these verifier overrides accept.
  const stateOverrides = await verifierOverrides(provider!, poolsToWithdrawFrom.map(addressToHex));

  // deposits[1..]: proved with recipient = shared sender, relayer = 0, fee = 0
  // (gas is already sponsored via deposit[0]'s fee). Encode each as a direct
  // pool.withdraw against its own pool, reusing the proof's own args so the call
  // exactly matches the proof's bound public inputs. A real proof here could be
  // submitted on its own, so estimation uses dummy-proof calls instead.
  const ZERO_ADDRESS = 0n as Address;
  const directWithdrawCalls = async (simulation: boolean): Promise<TxData[]> => {
    const calls: TxData[] = [];

    for (const deposit of directDeposits) {
      const proof = await prove(deposit, senderAddress, ZERO_ADDRESS, 0n, simulation);
      const [root, nullifierHash, proofRecipient, relayerArg, feeArg, refundArg] = proof.args;
      const data = encodeFunctionData({
        abi: poolAbi,
        functionName: 'withdraw',
        args: [proof.proof, root, nullifierHash, proofRecipient, relayerArg, BigInt(feeArg), BigInt(refundArg)],
      });

      calls.push(createTx(addressToHex(deposit.pool), data, 0n));
    }

    return calls;
  };
  const simulatedDirectCalls = await directWithdrawCalls(true);

  // Total asset released across the batch, used to forward the accumulated
  // balance (minus deposit[0]'s fee) when the caller supplied no tailCalls.
  const totalDenomination = deposits.reduce(
    (sum, d) => sum + pools.get(d.pool)!.denomination, 0n,
  );

  const forwardCalls = (fee: bigint): TxData[] => {
    const amount = totalDenomination - fee;
  
    if (BigInt(originalRecipient) === senderAddress) return [];

    if (poolInfo.isERC20) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [addressToHex(originalRecipient), amount],
      });

      return [createTx(addressToHex(poolInfo.asset), data, 0n)];
    }

    return [createTx(addressToHex(originalRecipient), '0x', amount)];
  };

  // The caller's tail calls, resolved once: every build signs or estimates
  // these same calls.
  const resolvedTailCalls = tailCalls ? await resolveTailCalls(tailCalls, executionSender(delegation, signer)) : undefined;

  // callData order: direct withdraws first (they fund the sender), then either
  // the caller's tailCalls or the synthesized forward to the recipient.
  const composeTailCalls = (fee: bigint, directCalls: TxData[]) => async (): Promise<TxData[]> => [
    ...directCalls,
    ...(resolvedTailCalls ?? forwardCalls(fee)),
  ];

  // `simulation` builds the estimation payload: dummy proofs and signatures that
  // the bundler cannot submit. Only the final build proves and signs.
  const buildOp = async (gas: UserOpGasLimits, simulation: boolean) => {
    const fee = await quoteFee(computeMinimumViableFee(gas, maxFeePerGas));

    if (fee >= pools.get(sponsoringDeposit.pool)!.denomination) {
      throw new Error('Tornado paymaster fee would consume the sponsoring note. Use a larger note or wait for lower gas prices.');
    }

    const sponsoringProof = await prove(sponsoringDeposit, validationOnly ? originalRecipient : senderAddress, relayerAddress, fee, simulation);
    // Batched deposits are proved for real only in the final build.
    const directCalls = simulation ? simulatedDirectCalls : await directWithdrawCalls(false);
    const userOperation = await (simulation ? buildSimulationTornadoUserOp : buildSignedTornadoUserOp)({
      signer,
      executionAccount: accountConfig,
      chainId,
      entryPointAddress,
      paymasterAddress,
      paymasterData: buildPaymasterData(sponsoringDeposit.pool, sponsoringProof),
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      tailCalls: validationOnly ? undefined : composeTailCalls(fee, directCalls),
      nonce: userOpNonce,
      authorizationNonce,
    });

    return { sponsoringProof, userOperation, fee };
  };

  // Every refinement re-quotes the pool asset and rebuilds the simulation
  // payload; the converged gas is proven and signed once.
  const baselineGas = executionGasBaseline(accountConfig, validationOnly ? { ...reasonableGasUnits(poolInfo.isERC20), callGasLimit: 0n } : reasonableGasUnitsForBatch(
    poolInfo.isERC20,
    directDeposits.length,
    tailCalls != null,
    tailCallsGasEstimate,
  ));
  const { sponsoringProof, userOperation, gasEstimation, fee } = await buildEstimatedTornadoUserOp(
    baselineGas,
    async (gas) => (await buildOp(gas, true)).userOperation,
    (gas) => buildOp(gas, false),
    (op) => estimateUserOperationGas(bundlerClient, op, entryPointAddress, stateOverrides),
    {
      validateGas: (gas, op) => assertGasLimitsWithinBounds(gas, baselineGas, op, maxGasLimits, poolInfo.isERC20),
      allowFallback,
      isERC20: poolInfo.isERC20,
      executionGasRetryLimit,
    },
  );

  return [{
    mode: 'paymaster' as const,
    proof: sponsoringProof,
    poolAddress: sponsoringDeposit.pool,
    isERC20: poolInfo.isERC20,
    paymasterAddress,
    entryPointAddress,
    bundlerUrl,
    userOperation,
    // Kept so a lost send reply can be recovered by hash for any sender: a
    // smart-account userOp carries no 7702 authorization to read the chain from.
    userOpHash: serializedUserOperationHash(userOperation, entryPointAddress, chainId),
    gasEstimation,
    fee,
    withdrawnValue: totalDenomination,
  }] satisfies IGenericPaymasterWithdrawalPayload[];
});
