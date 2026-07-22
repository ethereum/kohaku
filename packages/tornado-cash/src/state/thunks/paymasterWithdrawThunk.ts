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
import { buildSignedTornadoUserOp, createPaymasterBundlerClient, estimateUserOperationGas, getUserOperationGasPrice } from "../../paymaster/utils";
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
  callGasLimitEstimate?: bigint;
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
  callGasLimitEstimate,
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

  // The relayer address in the sponsoring proof is the paymaster — it receives
  // the fee that reimburses the sponsored gas for the whole userOp.
  const relayerAddress = BigInt(paymasterAddress) as Address;
  const bigintChainId = await dataService.getChainId();
  const { recipient: originalRecipient, ...restWithoutRecipient } = rest;

  // Price an ETH-denominated fee in the pool asset via the paymaster's own
  // oracle (same pool/TWAP it enforces in validation), so feePaid >= required
  // holds by construction. Native pools pay the fee directly in ETH.
  const quoteFee = async (ethFee: bigint): Promise<bigint> =>
    poolInfo.isERC20
      ? dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, poolInfo.asset, ethFee)
      : ethFee;

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

  const ephemeralSigner = async (deposit: (typeof deposits)[number]): Promise<DelegatorAccount> =>
    privateKeyToAccount(await secretManager.deriveEphemeralSigner({
      depositIndex: deposit.index,
      chainId: bigintChainId,
      poolAddress: deposit.pool,
    }));

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

    const gasUnits = reasonableGasUnits(poolInfo.isERC20);
    const fee = await quoteFee(computeMinimumViableFee(gasUnits, maxFeePerGas));
    const proof = await prove(deposit, originalRecipient, relayerAddress, fee);

    const userOperation = await buildSignedTornadoUserOp({
      signer,
      chainId,
      paymasterAddress,
      paymasterData: buildPaymasterData(deposit.pool, proof),
      gas: { ...gasUnits, callGasLimit: 0n },
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce: 0n,
    });

    return [{
      mode: 'paymaster' as const,
      proof,
      poolAddress: deposit.pool,
      isERC20: poolInfo.isERC20,
      paymasterAddress,
      entryPointAddress,
      bundlerUrl,
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

  // Total asset released across the batch, used to forward the accumulated
  // balance (minus deposit[0]'s fee) when the caller supplied no tailCalls.
  const totalDenomination = deposits.reduce(
    (sum, d) => sum + pools.get(d.pool)!.denomination, 0n,
  );

  const forwardCalls = (fee: bigint): TxData[] => {
    const amount = totalDenomination - fee;
  
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

  // Baseline (generous) gas + fee, sized by deposit count. Deposit[0] is proved
  // at this fee and a provisional op assembled; the bundler then refines the
  // limits. We re-prove deposit[0] once at the estimate-derived fee so the
  // sponsoring proof matches the tight limits (the baseline fee is a generous
  // ceiling, so it always clears the paymaster's fee check during estimation).
  // Estimation is best-effort — on any failure we keep the safe baseline.
  const baselineGas = reasonableGasUnitsForBatch(
    poolInfo.isERC20,
    directDeposits.length,
    tailCalls != null,
    callGasLimitEstimate,
  );
  let fee = await quoteFee(computeMinimumViableFee(baselineGas, maxFeePerGas));
  let gas: UserOpGasLimits = baselineGas;
  let sponsoringProof = await prove(sponsoringDeposit, senderAddress, relayerAddress, fee);
  let userOperation = await buildOp(gas, fee, buildPaymasterData(sponsoringDeposit.pool, sponsoringProof));

  try {
    const estimated = await estimateUserOperationGas(bundlerClient, userOperation, entryPointAddress);
    // The bundler's estimate is authoritative; apply a 20% buffer and fall back
    // to the baseline only for any field it leaves at 0.
    const buffer = (x: bigint) => (x * 12n) / 10n;
    const orBaseline = (e: bigint, b: bigint) => (e > 0n ? buffer(e) : b);

    const refinedGas: UserOpGasLimits = {
      callGasLimit: orBaseline(estimated.callGasLimit, baselineGas.callGasLimit),
      verificationGasLimit: orBaseline(estimated.verificationGasLimit, baselineGas.verificationGasLimit),
      preVerificationGas: orBaseline(estimated.preVerificationGas, baselineGas.preVerificationGas),
      paymasterVerificationGasLimit: orBaseline(estimated.paymasterVerificationGasLimit, baselineGas.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: orBaseline(estimated.paymasterPostOpGasLimit, baselineGas.paymasterPostOpGasLimit),
    };

    fee = await quoteFee(computeMinimumViableFee(refinedGas, maxFeePerGas));
    gas = refinedGas;
    sponsoringProof = await prove(sponsoringDeposit, senderAddress, relayerAddress, fee);
    userOperation = await buildOp(gas, fee, buildPaymasterData(sponsoringDeposit.pool, sponsoringProof));
  } catch {
    // Bundler estimation unavailable/failed — keep the baseline-sized op.
  }

  return [{
    mode: 'paymaster' as const,
    proof: sponsoringProof,
    poolAddress: sponsoringDeposit.pool,
    isERC20: poolInfo.isERC20,
    paymasterAddress,
    entryPointAddress,
    bundlerUrl,
    userOperation,
  }] satisfies IGenericPaymasterWithdrawalPayload[];
});
