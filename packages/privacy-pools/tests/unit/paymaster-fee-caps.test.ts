import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, parseAbiParameters, toHex } from 'viem';

import type { ISecretManager } from '../../src/account/keys';
import { E_ADDRESS } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { computeMinimumViableFee, reasonableGasUnits } from '../../src/paymaster/fee';
import {
  assertFeeWithinCap,
  DEFAULT_PAYMASTER_MAX_FEE_BPS,
  gasPriceCaps,
  GAS_LIMIT_CAP_MULTIPLIER,
} from '../../src/paymaster/fee-caps';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerEntrypointDeposits } from '../../src/state/slices/entrypointDepositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

// Proving is stubbed: these tests are about what reaches the bundler, not the proof.
const { proveCalls } = vi.hoisted(() => ({ proveCalls: { count: 0 } }));

vi.mock('../../src/state/thunks/withdrawThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return {
    withdrawThunk: createAsyncThunk('withdraw/generateProof', async () => {
      proveCalls.count += 1;

      return {
        proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['1', '2', '1'] },
        publicSignals: ['0', '0', '0', '0', '0', '0', '0', '0'],
        mappedSignals: {},
      };
    }),
  };
});

const GWEI = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const POOL = 0x1000n as Address;
const ADAPTER = '0x000000000000000000000000000000000000ada9';
const PAYMASTER = '0x000000000000000000000000000000000000fee1';
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const BUNDLER_URL = 'https://bundler.test/rpc';
const EPHEMERAL_KEY = `0x${'11'.repeat(32)}` as const;
// The chain's fee market as the host provider reports it.
const FEE_REFERENCE = { baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 1n * GWEI };
const HONEST_PRICE = { maxFeePerGas: 13n * GWEI, maxPriorityFeePerGas: 1n * GWEI };

type GasLimitsHex = Record<string, `0x${string}`>;

/** A scripted bundler; records every JSON-RPC request and the transport it came over. */
const mockBundler = ({
  price = HONEST_PRICE,
  estimate,
}: { price?: typeof HONEST_PRICE; estimate?: GasLimitsHex } = {}) => {
  const requests: { via: 'network' | 'global'; method: string; params: unknown[] }[] = [];
  const handler = (via: 'network' | 'global') => async (_input: RequestInfo | URL, init?: RequestInit) => {
    // `envelope` keeps the request's jsonrpc/id for the reply.
    const { method, params, ...envelope } = JSON.parse(String(init?.body));

    requests.push({ via, method, params });

    const tier = { maxFeePerGas: toHex(price.maxFeePerGas), maxPriorityFeePerGas: toHex(price.maxPriorityFeePerGas) };
    const result =
      method === 'pimlico_getUserOperationGasPrice' ? { slow: tier, standard: tier, fast: tier } :
      method === 'eth_estimateUserOperationGas' && estimate ? estimate :
      undefined;
    const body = result
      ? { ...envelope, result }
      : { ...envelope, error: { code: -32601, message: `${method} unavailable` } };

    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };

  return { requests, network: { fetch: handler('network') }, globalFetch: handler('global') };
};

const setup = (bundler: ReturnType<typeof mockBundler>, noteValue = ONE_ETH) => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 0n },
  });
  const deposit = {
    pool: POOL, depositor: 3000n as Address, commitment: 11n, label: 10n, precommitment: 1n,
    value: noteValue, blockNumber: 5n, transactionHash: 0n,
  };

  store.dispatch(registerPools([
    { address: POOL, asset: BigInt(E_ADDRESS) as Address, scope: 1n, registeredBlock: 0n, woundDownAtBlock: null },
  ]));
  store.dispatch(registerAspTree({ leaves: [deposit.label], aspTreeRoot: 1n, blockNumber: 1n }));
  store.dispatch(registerDeposits([deposit]));
  store.dispatch(registerEntrypointDeposits([
    { depositor: deposit.depositor, poolAddress: POOL, commitment: deposit.commitment, blockNumber: 5n, transactionHash: 0n },
  ]));
  store.dispatch(addUserSecret({
    depositIndex: 0,
    noteSecrets: [{ noteIndex: 0, nullifier: 0n, salt: 0n, precommitment: deposit.precommitment, nullifierHash: 111n }],
  }));

  vi.stubGlobal('fetch', bundler.globalFetch);

  const withdraw = (overrides: { amount?: bigint; maxFeeBPS?: bigint } = {}) => store.dispatch(paymasterWithdrawThunk({
    getNextNote: vi.fn(),
    proverFactory: vi.fn(),
    dataService: {
      getGasFeeReference: async () => FEE_REFERENCE,
    } as unknown as IDataService,
    secretManager: { deriveEphemeralSigner: async () => EPHEMERAL_KEY } as unknown as ISecretManager,
    asset: BigInt(E_ADDRESS) as Address,
    amount: overrides.amount ?? noteValue,
    recipient: 0xbeefn as Address,
    paymasterConfig: {
      bundlerUrl: BUNDLER_URL,
      entryPointAddress: ENTRY_POINT,
      paymasterAddress: PAYMASTER,
      poolsAccountsMap: { [toHex(POOL, { size: 20 })]: ADAPTER },
    },
    maxFeeBPS: overrides.maxFeeBPS,
    network: bundler.network,
  })).unwrap();

  return { withdraw };
};

const sentUserOps = (bundler: ReturnType<typeof mockBundler>) =>
  bundler.requests
    .filter(({ method }) => method === 'eth_estimateUserOperationGas' || method === 'eth_sendUserOperation')
    .map(({ params }) => params[0] as Record<string, `0x${string}`>);

/** The fee committed in the op's paymasterData (adapter data -> withdrawal.data -> FeeData.fee). */
const committedFee = (op: Record<string, `0x${string}`>) => {
  const [{ adapterData }] = decodeAbiParameters(parseAbiParameters('(address adapter, bytes adapterData)'), op.paymasterData!);
  const [{ withdrawal }] = decodeAbiParameters(
    parseAbiParameters('((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'),
    adapterData,
  );
  const [{ fee }] = decodeAbiParameters(
    parseAbiParameters('(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'),
    withdrawal.data,
  );

  return fee;
};

describe('paymaster fee caps', () => {
  beforeEach(() => {
    proveCalls.count = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('gasPriceCaps', () => {
    it('allows 3x the base fee plus a tip of max(2 gwei, 3x the node suggestion)', () => {
      expect(gasPriceCaps({ baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 1n * GWEI })).toEqual({
        maxFeePerGas: 33n * GWEI,
        maxPriorityFeePerGas: 3n * GWEI,
      });
      // Quiet chain or no tip suggestion: the floor applies.
      expect(gasPriceCaps({ baseFeePerGas: 1n, maxPriorityFeePerGas: 0n })).toEqual({
        maxFeePerGas: 3n + 2n * GWEI,
        maxPriorityFeePerGas: 2n * GWEI,
      });
    });
  });

  describe('assertFeeWithinCap', () => {
    it('defaults to 10% of the withdrawn amount', () => {
      expect(DEFAULT_PAYMASTER_MAX_FEE_BPS).toBe(1_000n);
      expect(() => assertFeeWithinCap(100n, 1_000n)).not.toThrow();
      expect(() => assertFeeWithinCap(101n, 1_000n)).toThrow(/exceeds 1000 bps/);
    });

    it('rejects out-of-range caps', () => {
      expect(() => assertFeeWithinCap(1n, 1_000n, 0n)).toThrow(/maxFeeBPS/);
      expect(() => assertFeeWithinCap(1n, 1_000n, 10_001n)).toThrow(/maxFeeBPS/);
    });
  });

  describe('paymasterWithdrawThunk', () => {
    it('rejects a bundler maxFeePerGas above the chain-derived cap before signing anything', async () => {
      // 500 gwei: a fee of 1.4M gas * 500 gwei * 1.2 = 0.84 ETH, still under the 1 ETH note.
      const bundler = mockBundler({ price: { maxFeePerGas: 500n * GWEI, maxPriorityFeePerGas: 1n * GWEI } });

      await expect(setup(bundler).withdraw()).rejects.toThrow(/maxFeePerGas .* exceeds the cap/);
      expect(sentUserOps(bundler)).toEqual([]);
      expect(proveCalls.count).toBe(0);
    });

    it('rejects a bundler maxPriorityFeePerGas above the cap', async () => {
      const bundler = mockBundler({ price: { maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 20n * GWEI } });

      await expect(setup(bundler).withdraw()).rejects.toThrow(/maxPriorityFeePerGas .* exceeds the cap/);
      expect(sentUserOps(bundler)).toEqual([]);
    });

    it('rejects an inflated preVerificationGas from the bundler estimate', async () => {
      const baseline = reasonableGasUnits(false);
      const bundler = mockBundler({
        estimate: {
          callGasLimit: toHex(0n),
          verificationGasLimit: toHex(baseline.verificationGasLimit),
          preVerificationGas: toHex(10_000_000n),
          paymasterVerificationGasLimit: toHex(baseline.paymasterVerificationGasLimit),
          paymasterPostOpGasLimit: toHex(baseline.paymasterPostOpGasLimit),
        },
      });

      await expect(setup(bundler).withdraw()).rejects.toThrow(/preVerificationGas .* exceeds the cap/);
      // Only the baseline op was sent for estimation; nothing was built from the inflated limits.
      expect(sentUserOps(bundler)).toHaveLength(1);
      expect(proveCalls.count).toBe(1);
    });

    it('rejects a fee above maxFeeBPS before proving or contacting the bundler with an op', async () => {
      const bundler = mockBundler();
      // Baseline fee at the honest price is 1.4M gas * 13 gwei * 1.2 ~ 0.022 ETH: 2.2% of 1 ETH.
      const { withdraw } = setup(bundler);

      await expect(withdraw({ maxFeeBPS: 100n })).rejects.toThrow(/exceeds 100 bps of the withdrawn amount/);
      expect(sentUserOps(bundler)).toEqual([]);
      expect(proveCalls.count).toBe(0);
    });

    it('applies the 10% default fee cap', async () => {
      const bundler = mockBundler();
      // 0.15 ETH: the ~0.022 ETH baseline fee is ~15%, above the default.
      const { withdraw } = setup(bundler, (ONE_ETH * 15n) / 100n);

      await expect(withdraw()).rejects.toThrow(/exceeds 1000 bps/);
      expect(sentUserOps(bundler)).toEqual([]);
    });

    it('sends the estimation op within the caps and only through host.network', async () => {
      const baseline = { ...reasonableGasUnits(false), callGasLimit: 0n };
      const bundler = mockBundler({
        estimate: {
          callGasLimit: toHex(0n),
          verificationGasLimit: toHex(40_000n),
          preVerificationGas: toHex(90_000n),
          paymasterVerificationGasLimit: toHex(900_000n),
          paymasterPostOpGasLimit: toHex(30_000n),
        },
      });

      const [withdrawal] = await setup(bundler).withdraw();
      const [estimationOp] = sentUserOps(bundler);
      const caps = gasPriceCaps(FEE_REFERENCE);

      expect(bundler.requests.every(({ via }) => via === 'network')).toBe(true);
      expect(BigInt(estimationOp!.maxFeePerGas)).toBeLessThanOrEqual(caps.maxFeePerGas);
      expect(BigInt(estimationOp!.maxPriorityFeePerGas)).toBeLessThanOrEqual(caps.maxPriorityFeePerGas);
      // The op sent before the user confirms carries the baseline limits and its fee.
      expect(BigInt(estimationOp!.preVerificationGas)).toBe(baseline.preVerificationGas);
      expect(BigInt(estimationOp!.paymasterVerificationGasLimit)).toBe(baseline.paymasterVerificationGasLimit);
      expect(committedFee(estimationOp!)).toBe(computeMinimumViableFee(baseline, HONEST_PRICE.maxFeePerGas));

      // The final op uses the refined limits, each within the cap, and a fee under 10%.
      const finalOp = withdrawal!.userOperation;

      expect(BigInt(finalOp.preVerificationGas)).toBe(108_000n);
      expect(BigInt(finalOp.preVerificationGas)).toBeLessThanOrEqual(baseline.preVerificationGas * GAS_LIMIT_CAP_MULTIPLIER);
      expect(withdrawal!.fee).toBe(committedFee(finalOp as unknown as Record<string, `0x${string}`>));
      expect(withdrawal!.fee * 10n).toBeLessThanOrEqual(ONE_ETH);
    });
  });
});
