import { privateKeyToAccount } from 'viem/accounts';
import {
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
export function createPaymasterBundlerClient(bundlerUrl: string): BundlerClient {
  return createBundlerClient({ transport: http(bundlerUrl) });
}

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
  } as any)) as any;

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
  } as any) as Promise<Hash>;
}

/**
 * A userOp serialized to the hex shape expected by `eth_sendUserOperation`, so
 * it can be carried as plain (JSON-serializable) data from the prepare phase
 * (thunk) to the broadcast phase.
 */
export interface SerializedUserOperation {
  sender: `0x${string}`;
  nonce: `0x${string}`;
  callData: `0x${string}`;
  callGasLimit: `0x${string}`;
  verificationGasLimit: `0x${string}`;
  preVerificationGas: `0x${string}`;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
  paymaster?: `0x${string}`;
  paymasterVerificationGasLimit?: `0x${string}`;
  paymasterPostOpGasLimit?: `0x${string}`;
  paymasterData?: `0x${string}`;
  signature: `0x${string}`;
  eip7702Auth?: ReturnType<typeof serializeAuth>;
}

export interface UserOpGasLimits {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

interface BuildSignedTornadoUserOpParams {
  privateKey: Hex;
  chainId: number;
  paymasterAddress: Address;
  paymasterData: Hex;
  gas: UserOpGasLimits;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * Builds and signs a paymaster-sponsored withdrawal userOp for an ephemeral
 * 7702 sender, returning it serialized for the broadcast phase.
 *
 * The sender is a fresh EOA (so its EntryPoint nonce is 0) delegated to the
 * Simple7702 implementation; the owner signs the userOp. No RPC access is
 * required — gas limits and fees are supplied by the caller.
 */
export async function buildSignedTornadoUserOp({
  privateKey,
  chainId,
  paymasterAddress,
  paymasterData,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas
}: BuildSignedTornadoUserOpParams): Promise<SerializedUserOperation> {

  const owner = privateKeyToAccount(privateKey);

  // Fresh EOA → nonce 0, both for the userOp and the 7702 authorization.
  const authorization = await owner.signAuthorization({
    address: SIMPLE_7702_IMPLEMENTATION,
    chainId,
    nonce: 0,
  });

  const userOperation = {
    sender: owner.address,
    nonce: 0n,
    callData: '0x' as Hex,
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
    eip7702Auth: serializeAuth(authorization),
  };
}

function serializeAuth(auth: SignedAuthorization) {
  return {
    address: (auth as any).address ?? (auth as any).contractAddress,
    chainId: toHex(auth.chainId),
    nonce: toHex(auth.nonce),
    r: auth.r,
    s: auth.s,
    yParity: toHex(auth.yParity!),
  };
}

