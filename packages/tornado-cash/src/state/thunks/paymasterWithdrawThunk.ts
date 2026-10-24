/* eslint-disable max-lines */
import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { AccountId } from "@kohaku-eth/plugins";
import { createTx, TxData } from "@kohaku-eth/provider";
import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { Address } from "../../interfaces/types.interface";
import { encodePaymasterData, encodeTornadoAdapterData } from "@privacy-paymasters/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi } from "viem";

import { computeMinimumViableFee, reasonableGasUnits, reasonableGasUnitsForBatch } from "../../paymaster/fee";
import { assertFeeWithinCap, assertGasLimitsWithinCaps, assertGasPriceWithinCaps } from "../../paymaster/fee-caps";
import {
  BundlerPost,
  buildSignedTornadoUserOp,
  createPaymasterBundlerClient,
  estimateUserOperationGas,
  getUserOperationGasPrice,
  networkFromBundlerPost,
} from "../../paymaster/utils";
import { poolAbi } from "../../data/abis/pool.abi";
import { addressToHex } from "../../utils";
import { UserOpGasLimits } from "../../interfaces/user-ops.interface";
import { DelegatorAccount } from "../../account/delegation.interface";
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
  /** Cap on the sponsored fee as a share of the withdrawn amount (bps). Defaults to `DEFAULT_PAYMASTER_MAX_FEE_BPS`. */
  maxFeeBPS?: bigint;
  /** Carries the bundler JSON-RPC over the host's `network.fetch` (the worker has no host). */
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
  maxFeeBPS,
  bundlerPost,
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

  const bundlerClient = createPaymasterBundlerClient(bundlerUrl, bundlerPost && networkFromBundlerPost(bundlerPost));

  // The bundler's gas price is only accepted within caps derived from the chain's own
  // fee market: the baseline userOp below is signed, proved, and sent to the bundler
  // for estimation before the user confirms, so the bundler could land it as-is.
  const [{ standard: gasPrice }, feeReference] = await Promise.all([
    getUserOperationGasPrice(bundlerClient),
    dataService.getGasFeeReference(),
  ]);

  assertGasPriceWithinCaps(gasPrice, feeReference);

  const { maxFeePerGas, maxPriorityFeePerGas } = gasPrice;

  // The static baselines in `reasonableGasUnits`/`reasonableGasUnitsForBatch` are
  // ceilings for a "typical" case, not a guarantee — a real groth16 verify +
  // merkle proof can land within a few thousand gas of paymasterVerificationGasLimit's
  // baseline, and the surrounding paymaster/adapter overhead plus EIP-150's 63/64
  // forwarding rule on the try/catch external call can then push the actual need
  // just over it, causing a silent (empty-reason) out-of-gas revert. The bundler's
  // own simulation knows the real cost, so refine against it whenever possible —
  // callers still get the baseline if the bundler can't be reached. An estimate
  // above the caps throws instead.
  const refineGasWithBundler = async (
    baselineGas: UserOpGasLimits,
    provisionalUserOperation: Awaited<ReturnType<typeof buildSignedTornadoUserOp>>,
  ): Promise<UserOpGasLimits> => {
    let estimated: UserOpGasLimits;

    try {
      estimated = await estimateUserOperationGas(bundlerClient, provisionalUserOperation, entryPointAddress);
    } catch {
      // Bundler estimation unavailable/failed — keep the safe baseline.
      return baselineGas;
    }

    // Apply a 20% buffer and fall back to the baseline only for any field the
    // bundler leaves at 0.
    const buffer = (x: bigint) => (x * 12n) / 10n;
    const orBaseline = (e: bigint, b: bigint) => (e > 0n ? buffer(e) : b);
    const refined: UserOpGasLimits = {
      // No execution phase keeps callGasLimit at 0 regardless of the estimate (a
      // nonzero value would trip TornadoFeeAdapter's `recipient != sender` check).
      callGasLimit: baselineGas.callGasLimit === 0n ? 0n : orBaseline(estimated.callGasLimit, baselineGas.callGasLimit),
      verificationGasLimit: orBaseline(estimated.verificationGasLimit, baselineGas.verificationGasLimit),
      preVerificationGas: orBaseline(estimated.preVerificationGas, baselineGas.preVerificationGas),
      paymasterVerificationGasLimit: orBaseline(estimated.paymasterVerificationGasLimit, baselineGas.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: orBaseline(estimated.paymasterPostOpGasLimit, baselineGas.paymasterPostOpGasLimit),
    };

    // preVerificationGas is charged in full and every limit raises the fee, so the
    // bundler's numbers are only accepted within a bounded margin over our baseline.
    assertGasLimitsWithinCaps(refined, baselineGas);

    return refined;
  };

  // The relayer address in the sponsoring proof is the paymaster — it receives
  // the fee that reimburses the sponsored gas for the whole userOp.
  const relayerAddress = BigInt(paymasterAddress) as Address;
  const bigintChainId = await dataService.getChainId();
  const { recipient: originalRecipient, ...restWithoutRecipient } = rest;

  // Total asset released across the withdrawal; deposits[0] pays the fee.
  const totalWithdrawn = deposits.reduce(
    (sum, d) => sum + pools.get(d.pool)!.denomination, 0n,
  );

  // Price an ETH-denominated fee in the pool asset via the paymaster's own
  // oracle (same pool/TWAP it enforces in validation), so feePaid >= required
  // holds by construction. Native pools pay the fee directly in ETH.
  const quoteFee = async (ethFee: bigint): Promise<bigint> => {
    const fee = poolInfo.isERC20
      ? await dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
      : ethFee;

    // The pool reverts on fee > denomination; fail before proving instead.
    if (fee > poolInfo.denomination) {
      throw new Error('Withdrawal amount too small to cover the sponsored gas fee');
    }

    // The fee committed in the proof bounds what a bundler can take from it.
    assertFeeWithinCap(fee, totalWithdrawn, maxFeeBPS);

    return fee;
  };

  const prove = async (
    deposit: (typeof deposits)[number],
    recipient: Address,
    relayer: Address,
    depositFee: bigint,
  ): Promise<TornadoProveOutput> =>
    unwrapResult(await dispatch(withdrawalsProofThunk({
      ...restWithoutRecipient,
      recipient,
      deposit,
      relayerAddress: relayer,
      fee: depositFee,
    })));

  // paymasterData wraps deposit[0]'s proof for the on-chain tornado adapter,
  // which relays it into pool.withdraw during paymaster validation.
  const buildPaymasterData = (poolAddress: bigint, proof: TornadoProveOutput) => {
    const [root, nullifierHash, proofRecipient, relayerArg, feeArg, refundArg] = proof.args;

    return encodePaymasterData(
      poolAcountsMap.get(poolAddress)!,
      encodeTornadoAdapterData(
        proof.proof, root, nullifierHash, proofRecipient, relayerArg, BigInt(feeArg), BigInt(refundArg),
      ),
    );
  };

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

  // The shared delegator that owns the consolidated userOp. All withdrawals land
  // in this EOA and are then spent by the execution phase (tailCalls or the
  // synthesized forward). It holds funds only transiently within the atomic
  // userOp, so it is recoverable by default; `random` opts out.
  const resolveBatchDelegator = async (): Promise<DelegatorAccount> => {
    if (delegation?.mode === 'random') return privateKeyToAccount(generatePrivateKey());
    
    if (delegation?.mode === 'deterministic' && delegation.path) {
      assertValidDelegatorPath(delegation.path);

      return privateKeyToAccount(await secretManager.deriveDelegatorSigner({ path: delegation.path }));
    }

    return ephemeralSigner(deposits[0]!);
  };

  // No tail calls, single deposit: a sender that never holds funds (the
  // withdrawal goes straight to the user's `recipient`), so a random default is
  // fine.
  const resolveIndependentSigner = (deposit: (typeof deposits)[number]): Promise<DelegatorAccount> =>
    delegation?.mode === 'deterministic'
      ? ephemeralSigner(deposit)
      : Promise.resolve(privateKeyToAccount(generatePrivateKey()));

  // A single deposit with no tailCalls needs no consolidation: the paymaster
  // releases the funds straight to the recipient in one userOp (callData empty,
  // the withdrawal happens during paymaster validation).
  const needsConsolidation = deposits.length > 1 || tailCalls != null;

  if (!needsConsolidation) {
    const deposit = deposits[0]!;
    const signer = await resolveIndependentSigner(deposit);

    // No execution phase in this flow (funds go straight to the recipient
    // during paymaster validation) — callGasLimit must stay 0 regardless of
    // what the bundler estimates for it (a nonzero value here would trip
    // TornadoFeeAdapter's `recipient != sender` check).
    const baselineGas: UserOpGasLimits = { ...reasonableGasUnits(poolInfo.isERC20), callGasLimit: 0n };
    let fee = await quoteFee(computeMinimumViableFee(baselineGas, maxFeePerGas));
    let gas = baselineGas;
    let proof = await prove(deposit, originalRecipient, relayerAddress, fee);
    let userOperation = await buildSignedTornadoUserOp({
      signer,
      chainId,
      paymasterAddress,
      paymasterData: buildPaymasterData(deposit.pool, proof),
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce: 0n,
    });

    const estimatedGas = await refineGasWithBundler(baselineGas, userOperation);

    if (estimatedGas !== baselineGas) {
      // callGasLimit stays 0 after refinement — see note above.
      gas = estimatedGas;
      fee = await quoteFee(computeMinimumViableFee(gas, maxFeePerGas));
      proof = await prove(deposit, originalRecipient, relayerAddress, fee);
      userOperation = await buildSignedTornadoUserOp({
        signer,
        chainId,
        paymasterAddress,
        paymasterData: buildPaymasterData(deposit.pool, proof),
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: 0n,
      });
    }

    return [{
      mode: 'paymaster' as const,
      proof,
      poolAddress: deposit.pool,
      isERC20: poolInfo.isERC20,
      paymasterAddress,
      entryPointAddress,
      bundlerUrl,
      withdrawnValue: totalWithdrawn,
      fee,
      userOperation,
    }] satisfies IGenericPaymasterWithdrawalPayload[];
  }

  // Consolidated batch: ONE userOp carrying ONE EIP-7702 authorization. This
  // avoids Pimlico's "AA10 sender already constructed: Sender already has an
  // inflight EIP-7702 authorization", which fires when several userOps for the
  // same shared sender each carry their own authorization. All deposits land in
  // one shared delegator; deposit[0] is sponsored by the paymaster, and the rest
  // run as direct pool.withdraw calls inside the execution phase (callData).
  const signer = await resolveBatchDelegator();
  const senderAddress = BigInt(signer.address) as Address;

  const sponsoringDeposit = deposits[0]!;
  const directDeposits = deposits.slice(1);

  // Baseline (generous) gas + fee, sized by deposit count, checked against the caps
  // before anything is proved or signed. Deposit[0] is proved at this fee and a
  // provisional op assembled; the bundler then refines the limits. We re-prove
  // deposit[0] once at the estimate-derived fee so the sponsoring proof matches the
  // tight limits (the baseline fee is a generous ceiling, so it always clears the
  // paymaster's fee check during estimation). Estimation is best-effort — on any
  // failure we keep the safe baseline.
  const baselineGas = reasonableGasUnitsForBatch(
    poolInfo.isERC20,
    directDeposits.length,
    tailCalls != null,
    tailCallsGasEstimate,
  );
  let fee = await quoteFee(computeMinimumViableFee(baselineGas, maxFeePerGas));

  // deposits[1..]: proved with recipient = shared sender, relayer = 0, fee = 0
  // (gas is already sponsored via deposit[0]'s fee). Encode each as a direct
  // pool.withdraw against its own pool, reusing the proof's own args so the call
  // exactly matches the proof's bound public inputs.
  const ZERO_ADDRESS = 0n as Address;
  const directWithdrawCalls: TxData[] = [];

  for (const deposit of directDeposits) {
    const proof = await prove(deposit, senderAddress, ZERO_ADDRESS, 0n);
    const [root, nullifierHash, proofRecipient, relayerArg, feeArg, refundArg] = proof.args;
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: 'withdraw',
      args: [proof.proof, root, nullifierHash, proofRecipient, relayerArg, BigInt(feeArg), BigInt(refundArg)],
    });
  
    directWithdrawCalls.push(createTx(addressToHex(deposit.pool), data, 0n));
  }

  // Forward the accumulated balance (minus deposit[0]'s fee) when the caller
  // supplied no tailCalls.
  const forwardCalls = (fee: bigint): TxData[] => {
    const amount = totalWithdrawn - fee;
  
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

  // callData order: direct withdraws first (they fund the sender), then either
  // the caller's tailCalls or the synthesized forward to the recipient.
  const composeTailCalls = (fee: bigint) => async (addr: AccountId): Promise<TxData[]> => [
    ...directWithdrawCalls,
    ...(tailCalls ? await tailCalls(addr) : forwardCalls(fee)),
  ];

  const buildOp = (gas: UserOpGasLimits, fee: bigint, paymasterData: `0x${string}`) =>
    buildSignedTornadoUserOp({
      signer,
      chainId,
      paymasterAddress,
      paymasterData,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      tailCalls: composeTailCalls(fee),
      nonce: 0n,
    });

  let gas: UserOpGasLimits = baselineGas;
  let sponsoringProof = await prove(sponsoringDeposit, senderAddress, relayerAddress, fee);
  let userOperation = await buildOp(gas, fee, buildPaymasterData(sponsoringDeposit.pool, sponsoringProof));

  const refinedGas = await refineGasWithBundler(baselineGas, userOperation);

  if (refinedGas !== baselineGas) {
    gas = refinedGas;
    fee = await quoteFee(computeMinimumViableFee(gas, maxFeePerGas));
    sponsoringProof = await prove(sponsoringDeposit, senderAddress, relayerAddress, fee);
    userOperation = await buildOp(gas, fee, buildPaymasterData(sponsoringDeposit.pool, sponsoringProof));
  }

  return [{
    mode: 'paymaster' as const,
    proof: sponsoringProof,
    poolAddress: sponsoringDeposit.pool,
    isERC20: poolInfo.isERC20,
    paymasterAddress,
    entryPointAddress,
    bundlerUrl,
    withdrawnValue: totalWithdrawn,
    fee,
    userOperation,
  }] satisfies IGenericPaymasterWithdrawalPayload[];
});
