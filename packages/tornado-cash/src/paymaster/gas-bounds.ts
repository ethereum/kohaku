import type { EthereumProvider } from '@kohaku-eth/provider';
import { size } from 'viem';
import { SINGLE_NOTE_FALLBACK_ERC20_PAYMASTER_GAS } from './fallback';
import type { SerializedUserOperation, UserOpGasLimits } from '../interfaces/user-ops.interface';

/** Optional absolute gas ceilings, in gas units, including estimation buffers. */
export type PaymasterGasLimits = Partial<UserOpGasLimits>;

type FeeReference = { baseFeePerGas: bigint; maxPriorityFeePerGas: bigint };
type GasPrice = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
const GAS_FIELDS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas',
  'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const;

// Keep the existing ceiling for successful estimates, independently of the
// 150k single-note fallback account-validation target.
const DIRECT_VERIFICATION_GAS_CEILING = 250_000n;

const MIN_TIP_CAP = 2_000_000_000n;
const MAX_TIP_CAP = 20_000_000_000n;

function hostFeeQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error('Invalid host gas price reference');
  }

  return BigInt(value);
}

/** Read the reference from the host RPC, independently of the bundler. */
export async function readGasFeeReference(provider?: Pick<EthereumProvider, 'request'>): Promise<FeeReference> {
  if (!provider) throw new Error('Paymaster gas price checks require the host provider');

  try {
    // feeHistory returns gas-weighted percentiles for EACH block, not the whole
    // range. Use the highest p90 to tolerate short spikes rather than averaging
    // them away. This is a safety ceiling, not our suggested transaction price.
    const history = await provider.request({ method: 'eth_feeHistory', params: ['0xa', 'latest', [90]] }) as
      { baseFeePerGas?: unknown; reward?: unknown } | null;

    if (!Array.isArray(history?.reward) || history.reward.length === 0 || history.reward.length > 10 ||
        !Array.isArray(history.baseFeePerGas) || history.baseFeePerGas.length !== history.reward.length + 1) {
      throw new Error('Invalid host fee history');
    }

    let tip = 0n;

    for (const row of history.reward) {
      if (!Array.isArray(row) || row.length !== 1) throw new Error('Invalid host fee history');

      const reward = hostFeeQuantity(row[0]);

      if (reward > tip) tip = reward;
    }

    // The last base fee is for the NEXT block. Preserve the existing ceiling's
    // latest-mined-block reference, from the same snapshot as the reward data.
    return { baseFeePerGas: hostFeeQuantity(history.baseFeePerGas.at(-2)), maxPriorityFeePerGas: tip };
  } catch {
    // Unsupported or malformed history must not automatically grant the hard cap.
    // Retain the conservative RPC-suggestion fallback, with the same hard cap.
  }

  const block = await provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }) as
    { baseFeePerGas?: string } | null;

  if (block?.baseFeePerGas == null) throw new Error('Failed to read the latest block base fee');

  const baseFeePerGas = hostFeeQuantity(block.baseFeePerGas);
  const tip = await provider.request({ method: 'eth_maxPriorityFeePerGas', params: [] })
    .then(hostFeeQuantity).catch(() => 0n);

  return { baseFeePerGas, maxPriorityFeePerGas: tip };
}

export function assertGasPriceWithinBounds(price: GasPrice, reference: FeeReference): void {
  const estimatedTipCap = reference.maxPriorityFeePerGas * 3n;
  const tipCap = estimatedTipCap < MIN_TIP_CAP ? MIN_TIP_CAP
    : estimatedTipCap > MAX_TIP_CAP ? MAX_TIP_CAP : estimatedTipCap;
  const feeCap = reference.baseFeePerGas * 3n + tipCap;

  if (typeof price.maxFeePerGas !== 'bigint' || typeof price.maxPriorityFeePerGas !== 'bigint' ||
      price.maxFeePerGas < 0n || price.maxPriorityFeePerGas < 0n ||
      price.maxPriorityFeePerGas > price.maxFeePerGas) {
    throw new Error('Bundler returned invalid gas prices');
  }

  if (price.maxPriorityFeePerGas > tipCap || price.maxFeePerGas > feeCap) {
    throw new Error('Bundler gas price exceeds the host RPC bounds ' +
      `(requested: maxFeePerGas=${price.maxFeePerGas}, maxPriorityFeePerGas=${price.maxPriorityFeePerGas}; ` +
      `limits: maxFeePerGas=${feeCap}, maxPriorityFeePerGas=${tipCap}; all in wei)`);
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
  isERC20 = false,
): void {
  const bytes = operation ? BigInt(size(operation.callData) + size(operation.paymasterData ?? '0x')) : 0n;
  const direct = operation?.callData === '0x' && operation.callGasLimit === '0x0';
  const defaults: PaymasterGasLimits = {
    verificationGasLimit: direct &&
      baseline.verificationGasLimit * 2n < DIRECT_VERIFICATION_GAS_CEILING
      ? DIRECT_VERIFICATION_GAS_CEILING : baseline.verificationGasLimit * 2n,
    paymasterVerificationGasLimit: direct && isERC20 && baseline.paymasterVerificationGasLimit * 2n < SINGLE_NOTE_FALLBACK_ERC20_PAYMASTER_GAS
      ? SINGLE_NOTE_FALLBACK_ERC20_PAYMASTER_GAS : baseline.paymasterVerificationGasLimit * 2n,
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
