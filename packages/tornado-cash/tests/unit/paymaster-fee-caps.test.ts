import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, parseAbiParameters, toHex } from 'viem';

import { TornadoCashConfigs } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { computeMinimumViableFee, reasonableGasUnits } from '../../src/paymaster/fee';
import { assertFeeWithinCap, DEFAULT_PAYMASTER_MAX_FEE_BPS, gasPriceCaps } from '../../src/paymaster/fee-caps';
import { bundlerPostVia } from '../../src/paymaster/utils';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeFactory } from '../../src/state/store';
import { paymasterWithdrawThunk } from '../../src/state/thunks/paymasterWithdrawThunk';

// Root checks, note selection and proving are stubbed: these tests are about what
// reaches the bundler, not the proof.
const { proofCalls, POOL } = vi.hoisted(() => ({ proofCalls: { count: 0 }, POOL: 0x8cc930096b4df705a007c4a039bdfa1320ed2508n }));

vi.mock('../../src/state/thunks/verifyRootsThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return { verifyRootsThunk: createAsyncThunk('verifyRoots', async () => undefined) };
});

vi.mock('../../src/state/thunks/withdrawalsProofThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');
  const { toHex: hex } = await import('viem');

  return {
    withdrawalsProofThunk: createAsyncThunk(
      'withdraw/proof',
      async ({ recipient, relayerAddress, fee }: { recipient: bigint; relayerAddress: bigint; fee: bigint }) => {
        proofCalls.count += 1;

        return {
          proof: `0x${'00'.repeat(256)}`,
          args: [hex(1n, { size: 32 }), hex(2n, { size: 32 }), hex(recipient, { size: 20 }), hex(relayerAddress, { size: 20 }), hex(fee, { size: 32 }), hex(0n, { size: 32 })],
        };
      },
    ),
  };
});

vi.mock('../../src/state/selectors/withdrawals.selector', () => ({
  getWithdrawableDepositsSelector: () => [{ pool: POOL, kind: 'hd', depositIndex: 0 }],
}));

const GWEI = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const CHAIN_ID = 11155111;
const ADAPTER = '0x000000000000000000000000000000000000ada9';
const PAYMASTER = '0x000000000000000000000000000000000000fee1';
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const BUNDLER_URL = 'https://bundler.test/rpc';
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

const setup = (bundler: ReturnType<typeof mockBundler>, denomination = ONE_ETH) => {
  const store = storeFactory({
    logLevel: 'off',
    protocolConfig: { ...TornadoCashConfigs[CHAIN_ID]!, chainId: BigInt(CHAIN_ID) },
  });

  store.dispatch(registerPools([{
    address: POOL as Address, asset: 0n as Address, isERC20: false, protocolFeePercentage: 0, denomination,
    registeredBlock: 0n, state: 0, rootHistorySize: 30,
  }]));

  vi.stubGlobal('fetch', bundler.globalFetch);

  const withdraw = (maxFeeBPS?: bigint) => store.dispatch(paymasterWithdrawThunk({
    proverFactory: vi.fn(),
    dataService: {
      getChainId: async () => BigInt(CHAIN_ID),
      getGasFeeReference: async () => FEE_REFERENCE,
    } as unknown as IDataService,
    assetAddress: 0n as Address,
    amount: denomination,
    recipient: 0xbeefn as Address,
    paymasterSettings: {
      [CHAIN_ID]: {
        bundlerUrl: BUNDLER_URL,
        entryPointAddress: ENTRY_POINT,
        paymasterAddress: PAYMASTER,
        poolsAccountsMap: { [toHex(POOL, { size: 20 })]: ADAPTER },
      },
    },
    secretManager: {} as never,
    maxFeeBPS,
    // What the plugin hands the worker: the host network behind a cloneable POST.
    bundlerPost: bundlerPostVia(bundler.network),
  })).unwrap();

  return { withdraw };
};

const sentUserOps = (bundler: ReturnType<typeof mockBundler>) =>
  bundler.requests
    .filter(({ method }) => method === 'eth_estimateUserOperationGas' || method === 'eth_sendUserOperation')
    .map(({ params }) => params[0] as Record<string, `0x${string}`>);

/** The fee bound in the op's sponsoring proof (TornadoFeeAdapter data). */
const committedFee = (op: Record<string, `0x${string}`>) => {
  const [{ adapterData }] = decodeAbiParameters(parseAbiParameters('(address adapter, bytes adapterData)'), op.paymasterData!);
  const [{ fee }] = decodeAbiParameters(
    parseAbiParameters('(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)'),
    adapterData,
  );

  return fee;
};

describe('paymaster fee caps', () => {
  beforeEach(() => {
    proofCalls.count = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caps gas prices at 3x base fee plus max(2 gwei, 3x the suggested tip)', () => {
    expect(gasPriceCaps({ baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 0n })).toEqual({
      maxFeePerGas: 32n * GWEI,
      maxPriorityFeePerGas: 2n * GWEI,
    });
  });

  it('defaults the fee cap to 10% of the withdrawn amount', () => {
    expect(DEFAULT_PAYMASTER_MAX_FEE_BPS).toBe(1_000n);
    expect(() => assertFeeWithinCap(101n, 1_000n)).toThrow(/exceeds 1000 bps/);
  });

  it('rejects a bundler maxFeePerGas above the chain-derived cap before proving anything', async () => {
    // 1000 gwei: a fee of 650k gas * 1000 gwei * 1.2 = 0.78 ETH, still under the 1 ETH note.
    const bundler = mockBundler({ price: { maxFeePerGas: 1_000n * GWEI, maxPriorityFeePerGas: 1n * GWEI } });

    await expect(setup(bundler).withdraw()).rejects.toThrow(/maxFeePerGas .* exceeds the cap/);
    expect(sentUserOps(bundler)).toEqual([]);
    expect(proofCalls.count).toBe(0);
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
    expect(proofCalls.count).toBe(1);
  });

  it('rejects a fee above maxFeeBPS before proving or sending an op', async () => {
    const bundler = mockBundler();

    // Baseline fee at the honest price is 650k gas * 13 gwei * 1.2 ~ 0.01 ETH: 1% of 1 ETH.
    await expect(setup(bundler).withdraw(50n)).rejects.toThrow(/exceeds 50 bps of the withdrawn amount/);
    expect(sentUserOps(bundler)).toEqual([]);
    expect(proofCalls.count).toBe(0);
  });

  it('applies the 10% default fee cap', async () => {
    const bundler = mockBundler();

    // 0.1 ETH pool: the ~0.01 ETH baseline fee is just over 10%.
    await expect(setup(bundler, ONE_ETH / 10n).withdraw()).rejects.toThrow(/exceeds 1000 bps/);
    expect(sentUserOps(bundler)).toEqual([]);
  });

  it('sends the estimation op within the caps and only through host.network', async () => {
    const baseline = { ...reasonableGasUnits(false), callGasLimit: 0n };
    const bundler = mockBundler({
      estimate: {
        callGasLimit: toHex(9_000n),
        verificationGasLimit: toHex(50_000n),
        preVerificationGas: toHex(97_000n),
        paymasterVerificationGasLimit: toHex(440_000n),
        paymasterPostOpGasLimit: toHex(16_000n),
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
    expect(committedFee(estimationOp!)).toBe(computeMinimumViableFee(baseline, HONEST_PRICE.maxFeePerGas));

    // The final op keeps callGasLimit at 0 and reports the proof-bound fee.
    if (withdrawal?.mode !== 'paymaster') throw new Error('expected a paymaster withdrawal');

    expect(BigInt(withdrawal.userOperation.callGasLimit)).toBe(0n);
    expect(BigInt(withdrawal.userOperation.preVerificationGas)).toBe(116_400n);
    expect(withdrawal.fee).toBe(committedFee(withdrawal.userOperation as unknown as Record<string, `0x${string}`>));
    expect(withdrawal.withdrawnValue).toBe(ONE_ETH);
  });
});
