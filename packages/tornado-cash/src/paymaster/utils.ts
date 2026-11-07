/* eslint-disable max-lines */
import { simpleAccountFactoryData } from '../account/execution-account';
import type { Network } from '@kohaku-eth/plugins';
import { privateKeyToAccount } from 'viem/accounts';
import {
  encodeFunctionData,
  http,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type SignedAuthorization,
} from 'viem';
import {
  createBundlerClient,
  entryPoint08Address,
  getUserOperationTypedData,
  type BundlerClient,
} from 'viem/account-abstraction';
import { SIMPLE_7702_EXECUTE_ABI } from '../data/abis/account.abi';
import { BuildSignedTornadoUserOpParams, SerializedAuth, SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

/**
 * EntryPoint v0.8 canonical Simple7702Account implementation. The ephemeral
 * withdrawal sender is 7702-delegated to this contract, whose `validateUserOp`
 * checks an owner ECDSA signature over the userOp hash.
 */
export const SIMPLE_7702_IMPLEMENTATION = '0xe6Cae83BdE06E4c305530e199D7217f42808555B' as const;

export type GasPrice = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export type UserOperationGasPrice = {
  slow: GasPrice;
  standard: GasPrice;
  fast: GasPrice;
};

/**
 * viem bundler client for the paymaster flow. We rely on viem's native
 * `waitForUserOperationReceipt` action directly; the two helpers below cover
 * the only methods viem doesn't expose natively.
 */
export function createPaymasterBundlerClient(bundlerUrl: string, network?: Network): BundlerClient {
  const fetchFn = network ? (input: RequestInfo | URL, init?: RequestInit) => network.fetch(input, init) : undefined;

  return createBundlerClient({
    transport: http(bundlerUrl, { timeout: 180_000, retryCount: 0, fetchFn }),
  });
}

/** Cloneable bundler POST carried over the restricted host bridge. */
export type BundlerPost = (url: string, body: string) => Promise<{ status: number; body: string }>;

export const bundlerPostVia = (network: Network): BundlerPost => async (url, body) => {
  const response = await network.fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });

  return { status: response.status, body: await response.text() };
};

export const networkFromBundlerPost = (post: BundlerPost): Network => ({
  fetch: async (input, init) => {
    const { status, body } = await post(String(input), String(init?.body ?? ''));

    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  },
});

/**
 * Pimlico gas-price oracle (`pimlico_getUserOperationGasPrice`). Not a standard
 * ERC-4337 bundler method, so it isn't on viem's bundler action surface — we
 * issue the raw request and parse the tiers ourselves.
 */
export async function getUserOperationGasPrice(
  client: BundlerClient,
): Promise<UserOperationGasPrice> {
  const result = (await client.request({
    method: 'pimlico_getUserOperationGasPrice',
    params: [],
  } as never)) as unknown as Record<'slow' | 'standard' | 'fast', { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } >;

  const parse = (tier: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }): GasPrice => ({
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
 * Sends an already-built, serialized (hex) userOp directly to the bundler.
 * viem's `sendUserOperation` rebuilds/re-signs from a structured op, but ours
 * is already finalized in the prepare phase, so we forward it verbatim.
 */
export async function sendSerializedUserOperation(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<Hash> {
  return client.request({
    method: 'eth_sendUserOperation',
    params: [op, entryPoint],
  }) as Promise<Hash>;
}


/** Returns the EVM address that would be the sender for a given ephemeral private key. */
export function ephemeralSenderAddress(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

/**
 * Bundler gas estimation (`eth_estimateUserOperationGas`) for an already-built,
 * serialized userOp. Used to size a consolidated batch userOp — whose execution
 * phase runs N-1 extra `pool.withdraw` calls — tightly instead of guessing. The
 * op must carry a valid `paymasterData`/`eip7702Auth` so the bundler can
 * simulate the paymaster's validation and the delegated execution.
 *
 * Not on viem's bundler action surface for our serialized shape, so we issue the
 * raw request and parse the returned limits ourselves. Preparation must stop on
 * failure: static limits may not cover the bundler's pre-verification overhead.
 */
export async function estimateUserOperationGas(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<UserOpGasLimits> {
  const result = (await client.request({
    method: 'eth_estimateUserOperationGas',
    params: [op, entryPoint],
  } as never)) as unknown as Record<'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas', Hex> & Partial<Record<'paymasterVerificationGasLimit' | 'paymasterPostOpGasLimit', Hex>>;

  return {
    callGasLimit: BigInt(result.callGasLimit),
    verificationGasLimit: BigInt(result.verificationGasLimit),
    preVerificationGas: BigInt(result.preVerificationGas),
    paymasterVerificationGasLimit: BigInt(result.paymasterVerificationGasLimit ?? 0),
    paymasterPostOpGasLimit: BigInt(result.paymasterPostOpGasLimit ?? 0),
  };
}

/**
 * Builds and signs a paymaster-sponsored withdrawal userOp for an ephemeral
 * 7702 sender, returning it serialized for the broadcast phase.
 *
 * The sender is delegated to Simple7702Account and signs the userOp. The
 * paymaster flow uses EntryPoint nonce 0, including for a wallet-path EOA with
 * prior transactions. The caller supplies that EOA's authorization nonce; this
 * helper performs no RPC reads.
 */
export async function buildSignedTornadoUserOp({
  signer,
  executionAccount,
  chainId,
  paymasterAddress,
  paymasterData,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  tailCalls = async () => [],
  nonce = 0n,
  authorizationNonce,
}: BuildSignedTornadoUserOpParams): Promise<SerializedUserOperation> {

  const owner = signer;

  const calls = await tailCalls(executionAccount?.kind === 'simple-account' ? executionAccount.address : owner.address);
  let callData: Hex = '0x';

  if (calls.length === 1) {
    const call = calls[0]!;

    callData = encodeFunctionData({
      abi: SIMPLE_7702_EXECUTE_ABI,
      functionName: 'execute',
      args: [call.to as Address, call.value, call.data as Hex],
    });
  } else if (calls.length > 1) {
    callData = encodeFunctionData({
      abi: SIMPLE_7702_EXECUTE_ABI,
      functionName: 'executeBatch',
      args: [calls.map(c => ({ target: c.to as Address, value: c.value, data: c.data as Hex }))],
    });
  }

  // A wallet-path sender may have prior EOA transactions even though this is
  // its first UserOperation. For note-derived/random senders both nonces stay 0.
  // EntryPoint nonce 0 is intentionally single-use for all paymaster withdrawals.
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

  // No client/transport needed: the Simple7702 sender is the owner EOA itself,
  // so signing is a purely local EIP-712 sign over the userOp hash.
  const signature = await owner.signTypedData(
    getUserOperationTypedData({
      chainId,
      entryPointAddress: entryPoint08Address,
      // we cast because viem type requires a `signature`, but under the hood UserOp typedData does not contain one
      userOperation: userOperation as Parameters<typeof getUserOperationTypedData>[0]['userOperation'],
    }),
  );

  return {
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
}

function serializeAuth(auth: SignedAuthorization): SerializedAuth {
  return {
    address: auth.address,
    chainId: toHex(auth.chainId),
    nonce: toHex(auth.nonce),
    r: auth.r,
    s: auth.s,
    yParity: toHex(auth.yParity!),
  };
}

