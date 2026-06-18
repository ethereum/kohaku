import { privateKeyToAccount } from 'viem/accounts';
import {
  http,
  toHex,
  createClient,
  createPublicClient,
  custom,
  walletActions,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type SignedAuthorization,
} from 'viem';
import {
  createBundlerClient as createViemBundlerClient,
  toSimple7702SmartAccount,
  type BundlerClient as ViemBundlerClient,
  type EstimateUserOperationGasReturnType,
  type UserOperationReceipt,
} from 'viem/account-abstraction';
import type { EthereumProvider } from '@kohaku-eth/provider';
import type { SignedDelegation } from '../relayer/interfaces/paymaster-client.interface';

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
 * Minimal user operation request for the paymaster-sponsored flow. The
 * withdrawal proof lives in `paymasterData`, so `callData` is empty and the
 * account is reached via a 7702 `authorization` rather than a signature.
 */
export interface UserOpRequest {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Address;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  signature: Hex;
  authorization?: SignedAuthorization;
}

const entryPointAbi = [
  {
    type: 'function',
    name: 'getNonce',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

/**
 * Thin bundler client for the paymaster flow.
 *
 * Previously provided by `@privacy-paymasters/sdk`, which dropped its bundler
 * helpers in 0.0.3 in favour of consumers driving the bundler directly. We keep
 * the small surface this package relies on here.
 */
export class BundlerClient {
  private client: ViemBundlerClient;

  constructor(bundlerUrl: string, public entryPoint: Address) {
    this.client = createViemBundlerClient({ transport: http(bundlerUrl) });
  }

  async estimateUserOperationGas(op: UserOpRequest): Promise<EstimateUserOperationGasReturnType> {
    return this.client.request({
      method: 'eth_estimateUserOperationGas',
      params: [
        {
          sender: op.sender,
          nonce: toHex(op.nonce),
          callData: op.callData,
          callGasLimit: toHex(0),
          verificationGasLimit: toHex(0),
          preVerificationGas: toHex(0),
          maxFeePerGas: toHex(0),
          maxPriorityFeePerGas: toHex(0),
          paymaster: op.paymaster,
          paymasterVerificationGasLimit: op.paymaster ? toHex(0) : undefined,
          paymasterPostOpGasLimit: op.paymaster ? toHex(0) : undefined,
          paymasterData: op.paymasterData,
          signature: op.signature,
          eip7702Auth: op.authorization ? serializeAuth(op.authorization) : undefined,
        },
        this.entryPoint,
      ],
    } as any);
  }

  async getUserOperationGasPrice(): Promise<UserOperationGasPrice> {
    const result = await this.client.request({
      method: 'pimlico_getUserOperationGasPrice',
      params: [],
    } as any);

    const parse = (tier: any): GasPrice => ({
      maxFeePerGas: BigInt(tier.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tier.maxPriorityFeePerGas),
    });

    return {
      slow: parse((result as any).slow),
      standard: parse((result as any).standard),
      fast: parse((result as any).fast),
    };
  }

  async sendUserOperation(op: UserOpRequest): Promise<Hash> {
    return this.client.request({
      method: 'eth_sendUserOperation',
      params: [
        {
          sender: op.sender,
          nonce: toHex(op.nonce),
          callData: op.callData,
          callGasLimit: toHex(op.callGasLimit),
          verificationGasLimit: toHex(op.verificationGasLimit),
          preVerificationGas: toHex(op.preVerificationGas),
          maxFeePerGas: toHex(op.maxFeePerGas),
          maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
          paymaster: op.paymaster,
          paymasterVerificationGasLimit: op.paymasterVerificationGasLimit
            ? toHex(op.paymasterVerificationGasLimit)
            : undefined,
          paymasterPostOpGasLimit: op.paymasterPostOpGasLimit
            ? toHex(op.paymasterPostOpGasLimit)
            : undefined,
          paymasterData: op.paymasterData,
          signature: op.signature,
          eip7702Auth: op.authorization ? serializeAuth(op.authorization) : undefined,
        },
        this.entryPoint,
      ],
    } as any);
  }

  /** Sends an already-built, serialized (hex) userOp directly to the bundler. */
  async sendSerializedUserOperation(op: SerializedUserOperation): Promise<Hash> {
    return this.client.request({
      method: 'eth_sendUserOperation',
      params: [op, this.entryPoint],
    } as any);
  }

  async waitForUserOperationReceipt(hash: Hash): Promise<UserOperationReceipt> {
    return this.client.waitForUserOperationReceipt({ hash });
  }
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
  const chain = {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1'] } },
  } as const satisfies Chain;

  // Transport is unused: signing the userOp + authorization is purely local.
  const client = createClient({ chain, transport: http() }).extend(walletActions);
  const account = await toSimple7702SmartAccount({
    client,
    owner,
    implementation: SIMPLE_7702_IMPLEMENTATION,
  });

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

  const signature = await account.signUserOperation(
    { ...userOperation, chainId } as Parameters<typeof account.signUserOperation>[0],
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

export function setupBundlerClient({
  bundlerUrl,
  entryPointAddress,
}: {
  chainId: number;
  bundlerUrl: string;
  entryPointAddress: `0x${string}`;
}) {
  return new BundlerClient(bundlerUrl, entryPointAddress);
}

/** Reads the EntryPoint nonce for `sender` over the kohaku provider. */
export async function getEntryPointNonce(
  provider: EthereumProvider,
  entryPoint: Address,
  sender: Address,
  key: bigint = 0n,
): Promise<bigint> {
  const rpcClient = createPublicClient({
    transport: custom({
      request: (args: { method: string; params?: unknown; }) =>
        provider.request({ method: args.method, params: args.params ?? [] }) as Promise<any>,
    }),
  });

  return rpcClient.readContract({
    address: entryPoint,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [sender, key],
  });
}

export async function signDelegationAuthorization({
  privateKey,
  accountAddress,
  chainId,
  nonce,
}: {
  privateKey: Hex;
  accountAddress: `0x${string}`;
  chainId: number;
  nonce: number;
}): Promise<SignedDelegation> {
  const account = privateKeyToAccount(privateKey);
  const authorization = await account.signAuthorization({
    contractAddress: accountAddress,
    chainId,
    nonce,
  });

  return { authorization, senderAddress: account.address };
}
