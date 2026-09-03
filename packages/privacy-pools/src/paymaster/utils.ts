import {
  http,
  toHex,
  type Address,
  type Hash,
  type SignedAuthorization,
} from "viem";
import {
  createBundlerClient,
  entryPoint08Address,
  getUserOperationTypedData,
  type BundlerClient,
} from "viem/account-abstraction";

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
export function createPaymasterBundlerClient(bundlerUrl: string): BundlerClient {
  return createBundlerClient({ transport: http(bundlerUrl) });
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

/** Sends an already-built, serialized (hex) userOp directly to the bundler. */
export async function sendSerializedUserOperation(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<Hash> {
  return client.request({
    method: "eth_sendUserOperation",
    params: [op, entryPoint],
  }) as Promise<Hash>;
}

/**
 * Bundler gas estimation (`eth_estimateUserOperationGas`) for an already-built,
 * serialized userOp. Best-effort: callers should fall back to static limits on
 * failure.
 */
export async function estimateUserOperationGas(
  client: BundlerClient,
  op: SerializedUserOperation,
  entryPoint: Address,
): Promise<UserOpGasLimits> {
  const result = (await client.request({
    method: "eth_estimateUserOperationGas",
    params: [op, entryPoint],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as any;

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
 * 7702 sender, returning it serialized for the broadcast phase. In the
 * single-note flow the execution phase is empty (callData `0x`): the withdrawal
 * happens during paymaster validation and funds go straight to the recipient.
 *
 * The sender is a fresh EOA (EntryPoint nonce 0) delegated to the Simple7702
 * implementation; the owner signs the userOp. No RPC access is required.
 */
export async function buildSignedUserOp({
  signer,
  chainId,
  paymasterAddress,
  paymasterData,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce = 0n,
}: BuildSignedUserOpParams): Promise<SerializedUserOperation> {
  const owner = signer;

  // The EIP-7702 authorization nonce must equal the sender's EOA nonce at bundle
  // time; a fresh single-use sender has nonce 0.
  const authorization = await owner.signAuthorization({
    address: SIMPLE_7702_IMPLEMENTATION,
    chainId,
    nonce: Number(nonce),
  });

  const userOperation = {
    sender: owner.address,
    nonce,
    callData: "0x" as const,
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

  const signature = await owner.signTypedData(
    getUserOperationTypedData({
      chainId,
      entryPointAddress: entryPoint08Address,
      // viem's type requires a `signature`, but the userOp typedData does not contain one.
      userOperation: userOperation as unknown as Parameters<
        typeof getUserOperationTypedData
      >[0]["userOperation"],
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
