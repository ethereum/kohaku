import type { EthereumProvider } from '@kohaku-eth/provider';
import { size } from 'viem';
import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

/** Optional absolute gas ceilings, in gas units, including estimation buffers. */
export type PaymasterGasLimits = Partial<UserOpGasLimits>;

type FeeReference = { baseFeePerGas: bigint; maxPriorityFeePerGas: bigint };
type GasPrice = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
const GAS_FIELDS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas',
  'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const;

/** Read the reference from the host RPC, independently of the bundler. */
export async function readGasFeeReference(provider?: Pick<EthereumProvider, 'request'>): Promise<FeeReference> {
  if (!provider) throw new Error('Paymaster gas price checks require the host provider');

  const block = await provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }) as
    { baseFeePerGas?: string } | null;

  if (block?.baseFeePerGas == null) throw new Error('Failed to read the latest block base fee');

  // Some providers do not implement this RPC. Keep the 2 gwei tip floor then.
  const tip = await provider.request({ method: 'eth_maxPriorityFeePerGas', params: [] })
    .then((value) => BigInt(value as string)).catch(() => 0n);
  const reference = { baseFeePerGas: BigInt(block.baseFeePerGas), maxPriorityFeePerGas: tip };

  if (reference.baseFeePerGas < 0n || tip < 0n) throw new Error('Invalid host gas price reference');

  return reference;
}

export function assertGasPriceWithinBounds(price: GasPrice, reference: FeeReference): void {
  const tipCap = reference.maxPriorityFeePerGas * 3n > 2_000_000_000n
    ? reference.maxPriorityFeePerGas * 3n : 2_000_000_000n;
  const feeCap = reference.baseFeePerGas * 3n + tipCap;

  if (typeof price.maxFeePerGas !== 'bigint' || typeof price.maxPriorityFeePerGas !== 'bigint' ||
      price.maxFeePerGas < 0n || price.maxPriorityFeePerGas < 0n ||
      price.maxPriorityFeePerGas > price.maxFeePerGas) {
    throw new Error('Bundler returned invalid gas prices');
  }

  if (price.maxPriorityFeePerGas > tipCap || price.maxFeePerGas > feeCap) {
    throw new Error(`Bundler gas price exceeds the host RPC bounds (maxFeePerGas=${feeCap}, maxPriorityFeePerGas=${tipCap})`);
  }
}

/**
 * Bound fixed validation overhead and fully charged preVerificationGas. Its
 * allowance grows with the actual payload (40 gas per variable byte, including
 * Ethereum's calldata floor) instead of freezing it at twice a 100k guess.
 * Execution gas depends on arbitrary tail calls: only an explicit caller ceiling
 * limits it. tailCallsGasEstimate remains an estimate, never an implicit ceiling.
 * Mirrored in the other protocol until the paymaster helpers share a module.
 */
export function assertGasLimitsWithinBounds(
  gas: UserOpGasLimits,
  baseline: UserOpGasLimits,
  operation?: SerializedUserOperation,
  limits: PaymasterGasLimits = {},
): void {
  const bytes = operation ? BigInt(size(operation.callData) + size(operation.paymasterData ?? '0x')) : 0n;
  const defaults: PaymasterGasLimits = {
    verificationGasLimit: baseline.verificationGasLimit * 2n,
    paymasterVerificationGasLimit: baseline.paymasterVerificationGasLimit * 2n,
    paymasterPostOpGasLimit: baseline.paymasterPostOpGasLimit * 2n,
    preVerificationGas: (350_000n + 40n * bytes) * 2n,
  };

  for (const field of GAS_FIELDS) {
    const cap = limits[field] ?? defaults[field];

    if (typeof gas[field] !== 'bigint' || gas[field] < 0n ||
        (cap !== undefined && (typeof cap !== 'bigint' || cap < 0n))) {
      throw new Error(`Invalid paymaster gas limit: ${field}`);
    }

    if (cap !== undefined && gas[field] > cap) {
      throw new Error(`Bundler ${field} ${gas[field]} exceeds the gas ceiling ${cap}`);
    }
  }
}
