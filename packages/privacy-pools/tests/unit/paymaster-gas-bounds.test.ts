import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, parseAbiParameters, toHex } from 'viem';

import type { ISecretManager } from '../../src/account/keys';
import { E_ADDRESS } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { reasonableGasUnits } from '../../src/paymaster/fee';
import type { PaymasterGasLimits } from '../../src/paymaster/gas-bounds';
import { storeStateManager } from '../../src/state/state-manager';
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

  const withdraw = (overrides: { amount?: bigint; maxGasLimits?: PaymasterGasLimits; tailCallsGasEstimate?: bigint; tailCalls?: () => Promise<{ to: `0x${string}`; value: bigint; data: `0x${string}` }[]> } = {}) => store.dispatch(paymasterWithdrawThunk({
    getNextNote: vi.fn(),
    proverFactory: vi.fn(),
    dataService: {} as IDataService,
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
    maxGasLimits: overrides.maxGasLimits,
    tailCalls: overrides.tailCalls,
    tailCallsGasEstimate: overrides.tailCallsGasEstimate,
    provider: { request: async ({ method }: { method: string }) => method === 'eth_getBlockByNumber'
      ? { baseFeePerGas: toHex(FEE_REFERENCE.baseFeePerGas) } : toHex(FEE_REFERENCE.maxPriorityFeePerGas) } as never,
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


const tailCalls = async () => [{ to: '0x000000000000000000000000000000000000beef' as const, value: 0n, data: '0x' as `0x${string}` }];
const estimate = (overrides: Partial<Record<keyof ReturnType<typeof reasonableGasUnits>, bigint>> = {}): GasLimitsHex =>
  Object.fromEntries(Object.entries({ ...reasonableGasUnits(false), ...overrides }).map(([k, v]) => [k, toHex(v)]));

describe('paymaster bundler safety', () => {
  beforeEach(() => { proveCalls.count = 0; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects gas prices above the host market before proving', async () => {
    const bundler = mockBundler({ price: { maxFeePerGas: 1_000n * GWEI, maxPriorityFeePerGas: GWEI } });

    await expect(setup(bundler).withdraw()).rejects.toThrow('host RPC bounds');
    expect(proveCalls.count).toBe(0);
    expect(sentUserOps(bundler)).toHaveLength(0);
  });

  it('refines execution gas for tail calls instead of retaining the 300k baseline', async () => {
    const bundler = mockBundler({ estimate: estimate({ callGasLimit: 400_000n }) });
    const [w] = await setup(bundler).withdraw({ tailCalls });

    expect(BigInt(w!.userOperation.callGasLimit)).toBe(480_000n);
    expect(w!.fee).toBe(committedFee(w!.userOperation as unknown as Record<string, `0x${string}`>));
    expect(bundler.requests.every(r => r.via === 'network')).toBe(true);
  });

  it('accepts multi-million gas tails and pre-verification costs that scale with calldata', async () => {
    const bundler = mockBundler({ estimate: estimate({ callGasLimit: 3_000_000n, preVerificationGas: 1_000_000n }) });
    const [w] = await setup(bundler).withdraw({ tailCalls: async () => [{ to: '0x000000000000000000000000000000000000beef', value: 0n, data: `0x${'11'.repeat(32_768)}` }] });

    expect(BigInt(w!.userOperation.callGasLimit)).toBe(3_600_000n);
    expect(BigInt(w!.userOperation.preVerificationGas)).toBe(1_200_000n);
  });

  it('allows most of a 0.01 ETH note to sponsor the operation', async () => {
    const bundler = mockBundler({ price: { maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI } });
    const note = ONE_ETH / 100n;
    const [w] = await setup(bundler, note).withdraw({ tailCalls });

    expect(w!.fee).toBeGreaterThan(note / 2n);
    expect(w!.fee).toBeLessThan(note);
  });

  it('still refuses fees beyond the sponsoring withdrawal', async () => {
    await expect(setup(mockBundler(), ONE_ETH / 100n).withdraw()).rejects.toThrow('too small');
    expect(proveCalls.count).toBe(0);
  });

  it('keeps execution gas at zero when no execution phase exists', async () => {
    const [w] = await setup(mockBundler({ estimate: estimate({ callGasLimit: 9_000n }) })).withdraw();

    expect(BigInt(w!.userOperation.callGasLimit)).toBe(0n);
  });

  it.each(['preVerificationGas', 'verificationGasLimit', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const)('rejects inflated %s without falling back', async field => {
    const bundler = mockBundler({ estimate: estimate({ [field]: 10_000_000n }) });

    await expect(setup(bundler).withdraw()).rejects.toThrow(field);
    expect(proveCalls.count).toBe(1);
  });

  it('honors explicit gas ceilings after buffering', async () => {
    const bundler = mockBundler({ estimate: estimate({ callGasLimit: 1_000_000n }) });

    await expect(setup(bundler).withdraw({ tailCalls, maxGasLimits: { callGasLimit: 500_000n } })).rejects.toThrow('callGasLimit');
    expect(proveCalls.count).toBe(1);
  });

  it('keeps a caller-provided heavy-tail baseline if estimation is unavailable', async () => {
    const [w] = await setup(mockBundler()).withdraw({ tailCalls, tailCallsGasEstimate: 2_000_000n });

    expect(BigInt(w!.userOperation.callGasLimit)).toBe(2_000_000n);
  });

  it('applies price checks to estimates with a custom data service, with no percentage cap', async () => {
    const bundler = mockBundler({ price: { maxFeePerGas: 3n * GWEI, maxPriorityFeePerGas: GWEI } });
    const manager = storeStateManager({
      dataService: { getChainId: async () => 1n },
      secretManager: {}, entrypoint: { address: 900n },
      paymasterConfig: { 1: { bundlerUrl: BUNDLER_URL, paymasterAddress: PAYMASTER } },
      provider: { request: async ({ method }: { method: string }) => method === 'eth_getBlockByNumber' ? { baseFeePerGas: toHex(10n * GWEI) } : toHex(GWEI) },
      network: bundler.network,
    } as never);
    const result = await manager.getUnshieldEstimate({ asset: BigInt(E_ADDRESS) as Address, amount: ONE_ETH / 100n, recipient: 0xbeefn as Address, mode: 'paymaster', hasTailCalls: true });

    expect(result.mode).toBe('paymaster');
    expect(result.fee).toBeGreaterThan(ONE_ETH / 200n);
    expect(bundler.requests.every(r => r.via === 'network')).toBe(true);
  });
});
