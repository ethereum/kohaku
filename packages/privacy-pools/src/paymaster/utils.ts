import { simpleAccountFactoryData } from '../account/execution-account';
import type { Network } from '@kohaku-eth/plugins';
/* eslint-disable max-lines */
import {
  BaseError,
  encodeFunctionData,
  hashTypedData,
  http,
  RpcRequestError,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type SignedAuthorization,
} from "viem";
import {
  createBundlerClient,
  entryPoint08Address,
  getUserOperationTypedData,
  type BundlerClient,
} from "viem/account-abstraction";

import { SIMPLE_7702_EXECUTE_ABI } from "../data/abis/account.abi";
import {
  BuildSignedUserOpParams,
  SerializedAuth,
  SerializedUserOperation,
  UserOpGasLimits,
} from "../interfaces/user-ops.interface";

/**
 * EntryPoint v0.8 canonical Simple7702Account implementation. The ephemeral
 * withdrawal sender is 7702-delegated to this contract, whose `validateUserOp`
 * checks an owner ECDSA signature over the userOp hash.
 */
export const SIMPLE_7702_IMPLEMENTATION = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

export type GasPrice = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export type UserOperationGasPrice = {
  slow: GasPrice;
  standard: GasPrice;
  fast: GasPrice;
};

/** viem bundler client for the paymaster flow. */
export function createPaymasterBundlerClient(bundlerUrl: string, network?: Network): BundlerClient {
  const fetchFn = network ? (input: RequestInfo | URL, init?: RequestInit) => network.fetch(input, init) : undefined;

  return createBundlerClient({ transport: http(bundlerUrl, { fetchFn }) });
}

/**
 * Pimlico gas-price oracle (`pimlico_getUserOperationGasPrice`). Not a standard
 * ERC-4337 bundler method, so we issue the raw request and parse the tiers.
 */
export async function getUserOperationGasPrice(
  client: BundlerClient,
): Promise<UserOperationGasPrice> {
  const result = (await client.request({
    method: "pimlico_getUserOperationGasPrice",
    params: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (tier: any): GasPrice => ({
    maxFeePerGas: BigInt(tier.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tier.maxPriorityFeePerGas),
  });

  return {
    slow: parse(result.slow),
    standard: parse(result.standard),
    fast: parse(result.fast),
  };
}

/**
 * Sends an already-built, serialized (hex) userOp directly to the bundler. Not
 * retried: a retry of a userOp the bundler already got is rejected like an
 * invalid one, which would hide that it was accepted.
 */
export async function sendSerializedUserOperation(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<Hash> {
  return client.request({
    method: "eth_sendUserOperation",
    params: [op, entryPoint],
  }, { retryCount: 0 }) as Promise<Hash>;
}

const bundlerRejection = (error: unknown): RpcRequestError | null =>
  error instanceof BaseError ? error.walk((e) => e instanceof RpcRequestError) as RpcRequestError | null : null;

/** Whether the bundler answered with a JSON-RPC error, as opposed to a transport failure. */
export const isBundlerRejection = (error: unknown): boolean => bundlerRejection(error) !== null;

/**
 * Whether the bundler rejected the send because it already has this exact
 * userOp, pending or being bundled. That is alto's answer to a resend; a
 * different userOp with the same sender and nonce gets an AA25/AA10 error.
 */
export const isAlreadyKnown = (error: unknown): boolean =>
  /already known/i.test(bundlerRejection(error)?.details ?? '');

/**
 * viem error messages embed the request body, which for the paymaster flow is
 * the signed userOp, and integrators forward errors to crash reporting. Only the
 * short message and the server-provided details are kept, and the original
 * error must never be attached as a `cause`.
 */
export const describeError = (error: unknown): string =>
  error instanceof BaseError
    ? [error.shortMessage, error.details].filter(Boolean).join(" ")
    : "Unknown error.";

/**
 * Bundler gas estimation (`eth_estimateUserOperationGas`) for an already-built,
 * serialized userOp. Best-effort: callers should fall back to static limits on
 * failure.
 *
 * @throws {Error} Whose message is safe to report: it never includes the userOp.
 */
export async function estimateUserOperationGas(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<UserOpGasLimits> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any;

  try {
    result = await client.request({
      method: "eth_estimateUserOperationGas",
      params: [op, entryPoint],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  } catch (error) {
    throw new Error(`Bundler gas estimation failed: ${describeError(error)}`);
  }

  return {
    callGasLimit: BigInt(result.callGasLimit),
    verificationGasLimit: BigInt(result.verificationGasLimit),
    preVerificationGas: BigInt(result.preVerificationGas),
    paymasterVerificationGasLimit: BigInt(result.paymasterVerificationGasLimit ?? 0),
    paymasterPostOpGasLimit: BigInt(result.paymasterPostOpGasLimit ?? 0),
  };
}

/**
 * The EntryPoint v0.8 hash of a userOp built by `buildSignedUserOp`, which is
 * what its sender signed. Covers payloads prepared before they carried
 * `userOpHash`. The chain is the one the 7702 authorization was signed for;
 * `undefined` without an authorization.
 */
export function serializedUserOperationHash(op: SerializedUserOperation, entryPoint: Address): Hash | undefined {
  if (!op.eip7702Auth) return undefined;

  const optional = (value?: Hex) => (value === undefined ? undefined : BigInt(value));

  return hashTypedData(getUserOperationTypedData({
    chainId: Number(op.eip7702Auth.chainId),
    entryPointAddress: entryPoint,
    userOperation: {
      sender: op.sender,
      nonce: BigInt(op.nonce),
      callData: op.callData,
      callGasLimit: BigInt(op.callGasLimit),
      verificationGasLimit: BigInt(op.verificationGasLimit),
      preVerificationGas: BigInt(op.preVerificationGas),
      maxFeePerGas: BigInt(op.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
      paymaster: op.paymaster,
      paymasterVerificationGasLimit: optional(op.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: optional(op.paymasterPostOpGasLimit),
      paymasterData: op.paymasterData,
      signature: op.signature,
    },
  }));
}

/**
 * Asks the bundler whether it knows a userOp. Some bundlers, alto among them,
 * only know mined userOps, not pending ones. viem's
 * `getUserOperation` is not used because it fails to format pending userOps,
 * whose `blockNumber` is null.
 */
export async function isUserOperationKnown(client: BundlerClient, hash: Hash): Promise<boolean> {
  const result = await client.request({
    method: "eth_getUserOperationByHash",
    params: [hash],
  });

  return result !== null;
}

/**
 * Builds and signs a paymaster-sponsored withdrawal userOp for an ephemeral
 * 7702 sender, returning it serialized for the broadcast phase. Without
 * `tailCalls` the execution phase is empty (callData `0x`) and the withdrawal
 * pays the recipient during paymaster validation. With `tailCalls`, the
 * withdrawal pays the sender and the execution phase (`execute`/`executeBatch`)
 * runs the caller's calls atomically.
 *
 * The sender is a fresh EOA (EntryPoint nonce 0) delegated to the Simple7702
 * implementation; the owner signs the userOp. No RPC access is required.
 * Also returns the userOp hash, which is what the owner signs.
 */
export async function buildSignedUserOp({
  signer,
  executionAccount,
  chainId,
  paymasterAddress,
  paymasterData,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce = 0n,
  authorizationNonce,
  tailCalls,
}: BuildSignedUserOpParams): Promise<{ userOperation: SerializedUserOperation; userOpHash: Hash }> {
  const owner = signer;

  const calls = tailCalls ? await tailCalls(executionAccount?.kind === 'simple-account' ? executionAccount.address : owner.address) : [];
  let callData: Hex = "0x";

  if (calls.length === 1) {
    const call = calls[0]!;

    callData = encodeFunctionData({
      abi: SIMPLE_7702_EXECUTE_ABI,
      functionName: "execute",
      args: [call.to as Address, call.value, call.data as Hex],
    });
  } else if (calls.length > 1) {
    callData = encodeFunctionData({
      abi: SIMPLE_7702_EXECUTE_ABI,
      functionName: "executeBatch",
      args: [calls.map((c) => ({ target: c.to as Address, value: c.value, data: c.data as Hex }))],
    });
  }

  // The EIP-7702 authorization nonce must equal the sender's EOA transaction
  // count at bundle time. A fresh single-use sender has nonce 0 (and no caller
  // passes `authorizationNonce`); a reused wallet-path delegator carries a
  // nonzero count, threaded in explicitly. This is the EOA nonce, distinct from
  // the EntryPoint `nonce` the userOp carries below.
  const nativeNonce = authorizationNonce ?? nonce;

  if (executionAccount?.kind !== 'simple-account' && (nativeNonce < 0n || nativeNonce > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('Authorization nonce exceeds the safe integer range');

  const authorization = executionAccount?.kind === 'simple-account' ? undefined : await owner.signAuthorization({
    address: executionAccount?.implementation ?? SIMPLE_7702_IMPLEMENTATION,
    chainId,
    nonce: Number(authorizationNonce ?? nonce),
  });
  const deployment = executionAccount?.kind === 'simple-account' && executionAccount.factory
    ? { factory: executionAccount.factory.address, factoryData: simpleAccountFactoryData(owner.address, executionAccount.factory) } : {};


  const userOperation = {
    sender: executionAccount?.kind === 'simple-account' ? executionAccount.address : owner.address,
    ...deployment,
    nonce,
    callData,
    callGasLimit: gas.callGasLimit,
    verificationGasLimit: gas.verificationGasLimit,
    preVerificationGas: gas.preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: paymasterAddress,
    paymasterVerificationGasLimit: gas.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit,
    paymasterData,
  };

  const typedData = getUserOperationTypedData({
    chainId,
    entryPointAddress: entryPoint08Address,
    // viem's type requires a `signature`, but the userOp typedData does not contain one.
    userOperation: userOperation as unknown as Parameters<
      typeof getUserOperationTypedData
    >[0]["userOperation"],
  });
  const signature = await owner.signTypedData(typedData);

  // From EntryPoint v0.8 on, the userOp hash is the EIP-712 hash of this typed data.
  const userOpHash = hashTypedData(typedData);

  const serialized: SerializedUserOperation = {
    sender: userOperation.sender,
    nonce: toHex(userOperation.nonce),
    callData: userOperation.callData,
    callGasLimit: toHex(userOperation.callGasLimit),
    verificationGasLimit: toHex(userOperation.verificationGasLimit),
    preVerificationGas: toHex(userOperation.preVerificationGas),
    maxFeePerGas: toHex(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: toHex(userOperation.maxPriorityFeePerGas),
    paymaster: userOperation.paymaster,
    paymasterVerificationGasLimit: toHex(userOperation.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: toHex(userOperation.paymasterPostOpGasLimit),
    paymasterData: userOperation.paymasterData,
    signature,
    ...deployment,
    ...(authorization ? { eip7702Auth: serializeAuth(authorization) } : {}),
  };

  return { userOperation: serialized, userOpHash };
}

function serializeAuth(auth: SignedAuthorization): SerializedAuth {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    address: (auth as any).address ?? (auth as any).contractAddress,
    chainId: toHex(auth.chainId),
    nonce: toHex(auth.nonce),
    r: auth.r,
    s: auth.s,
    yParity: toHex(auth.yParity!),
  };
}
