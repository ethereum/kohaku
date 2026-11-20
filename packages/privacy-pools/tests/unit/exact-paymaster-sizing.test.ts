import { beforeEach, describe, expect, it, vi } from 'vitest';

import { E_ADDRESS } from '../../src/config';
import type { Address } from '../../src/interfaces/types.interface';
import { executionGasBaseline } from '../../src/account/execution-account';
import type { ExecutionAccountConfig } from '../../src/interfaces/user-ops.interface';
import { computeMinimumViableFee, paymasterBaselineGas } from '../../src/paymaster/fee';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';

const GWEI = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const PRICE = { maxFeePerGas: 13n * GWEI, maxPriorityFeePerGas: GWEI };

// Approved 1 ETH notes: a batch of `amount` spends ceil(amount / 1 ETH) of them.
// A protected (random) plan spends `randomPlanSizes` notes, a different count per call.
const fixture = vi.hoisted(() => ({
  noteBalance: 10n ** 18n, notesHeld: 4,
  randomPlanSizes: [] as number[], plans: [] as unknown[][], prepared: [] as { amount: bigint; notesToSpend?: unknown[] }[],
}));

vi.mock('../../src/state/selectors/notes.selector', async original => {
  const { NotEnoughCommitsToSpendError } = await import('../../src/state/selectors/balance.selector');

  return {
    ...await original<typeof import('../../src/state/selectors/notes.selector')>(),
    getNotesToSpendSelector: (_state: unknown, _asset: bigint, amount: bigint) => {
      const count = Number((amount + fixture.noteBalance - 1n) / fixture.noteBalance);

      if (count > fixture.notesHeld) throw new NotEnoughCommitsToSpendError('not enough notes');

      return Array.from({ length: count }, (_, deposit) => ({ note: { deposit }, withdrawnValue: 0n }));
    },
  };
});
vi.mock('../../src/withdrawal/batch-plan', async original => ({
  ...await original<typeof import('../../src/withdrawal/batch-plan')>(),
  planObfuscatedBatchWithdrawal: () => {
    const plan = Array.from({ length: fixture.randomPlanSizes.shift() ?? 1 }, (_, deposit) => ({ note: { deposit }, withdrawnValue: 1n }));

    fixture.plans.push(plan);

    return plan;
  },
}));
vi.mock('../../src/state/thunks/paymasterWithdrawThunk', () => ({
  paymasterWithdrawThunk: (params: { amount: bigint; notesToSpend?: unknown[] }) => async () => {
    fixture.prepared.push(params);

    return { payload: [{ mode: 'paymaster' }] };
  },
}));
vi.mock('../../src/paymaster/utils', async original => ({
  ...await original<typeof import('../../src/paymaster/utils')>(),
  getUserOperationGasPrice: async () => ({ slow: PRICE, standard: PRICE, fast: PRICE }),
}));
vi.mock('../../src/paymaster/gas-bounds', async original => ({
  ...await original<typeof import('../../src/paymaster/gas-bounds')>(),
  readGasFeeReference: async () => ({ baseFeePerGas: 10n * GWEI, maxPriorityFeePerGas: GWEI }),
}));

const ETH = BigInt(E_ADDRESS) as Address;
/** The fee the withdrawal builder charges for an ETH withdrawal spending `noteCount` notes. */
const builtFee = (noteCount: number, account: ExecutionAccountConfig = { kind: 'eip7702' }) =>
  computeMinimumViableFee(executionGasBaseline(account, paymasterBaselineGas(false, noteCount, false)), PRICE.maxFeePerGas);

const SIMPLE_ACCOUNT = '0x00000000000000000000000000000000000000a5';
const FACTORY = { address: '0x00000000000000000000000000000000000000fa' as const, salt: 1n };

const manager = (accountCode = '0x') => storeStateManager({
  entrypoint: { address: 900n, deploymentBlock: 0n },
  dataService: { getChainId: async () => 1n },
  secretManager: {},
  paymasterConfig: { 1: { bundlerUrl: 'https://bundler.test/rpc', paymasterAddress: '0x000000000000000000000000000000000000fee1' } },
  provider: { request: async ({ method }: { method: string }) => method === 'eth_getCode' ? accountCode : '0x0' },
} as unknown as StoreFactoryParams);

/** Sizes and prepares an exact ETH withdrawal; returns the gross and what the builder was given. */
const exact = async (requestedNet: bigint, options: Record<string, unknown> = {}, accountCode?: string) => {
  const { grossAmount } = await manager(accountCode).getExactPaymasterWithdrawalPayloads({ asset: ETH, requestedNet, recipient: 0xbeefn as Address, ...options });

  return { grossAmount, prepared: fixture.prepared.at(-1)! };
};

beforeEach(() => {
  fixture.noteBalance = ONE_ETH;
  fixture.notesHeld = 4;
  fixture.randomPlanSizes = [];
  fixture.plans = [];
  fixture.prepared = [];
});

describe('paymaster unshield estimate', () => {
  it.each([[ONE_ETH / 2n, 1], [ONE_ETH + 1n, 2], [3n * ONE_ETH, 3]])('prices a batch of %s for the %s notes it spends', async (amount, noteCount) => {
    const { fee } = await manager().getUnshieldEstimate({ asset: ETH, amount, recipient: 0xbeefn as Address, mode: 'paymaster', batch: true });

    expect(fee).toBe(builtFee(noteCount));
  });

  it('keeps pricing a single note without batch', async () => {
    const { fee } = await manager().getUnshieldEstimate({ asset: ETH, amount: 3n * ONE_ETH, recipient: 0xbeefn as Address, mode: 'paymaster' });

    expect(fee).toBe(builtFee(1));
  });
});

describe('exact-output paymaster sizing', () => {
  it('prices the second note when the fee pushes the gross over a note boundary', async () => {
    // Fits one note, but not together with even a single-note fee.
    const requestedNet = ONE_ETH - builtFee(1) / 2n;
    const { grossAmount, prepared } = await exact(requestedNet, { batch: true });

    expect(grossAmount).toBe(requestedNet + builtFee(2));
    expect(prepared.amount).toBe(grossAmount);
  });

  it('prices the notes the requested net already needs', async () => {
    const requestedNet = 2n * ONE_ETH + 1n;

    expect((await exact(requestedNet, { batch: true })).grossAmount).toBe(requestedNet + builtFee(3));
  });

  it('prices one note without batch, whatever the amount', async () => {
    const requestedNet = ONE_ETH - builtFee(1) / 2n;

    expect((await exact(requestedNet)).grossAmount).toBe(requestedNet + builtFee(1));
  });

  it('fails when the fee-inclusive gross needs more notes than are held', async () => {
    fixture.notesHeld = 1;

    await expect(exact(ONE_ETH - builtFee(1) / 2n, { batch: true })).rejects.toThrow('not enough notes');
    expect(fixture.prepared).toHaveLength(0);
  });

  it('prepares the protected plan it priced, though fresh splits spend different numbers of notes', async () => {
    // Each new gross gets a fresh random split: 2 notes, then 3, then 1, then 1.
    fixture.randomPlanSizes = [2, 3, 1, 1];
    const requestedNet = ONE_ETH;
    const { grossAmount, prepared } = await exact(requestedNet, { batch: true, obfuscateAmounts: true });

    // The prepared plan is one of the planned splits, and the fee covers exactly its notes.
    expect(fixture.plans).toContain(prepared.notesToSpend);
    expect(prepared.notesToSpend).toHaveLength(1);
    expect(grossAmount).toBe(requestedNet + builtFee(1));
    expect(prepared.amount).toBe(grossAmount);
  });

  it('prices the deployment of a SimpleAccount that is not deployed yet', async () => {
    const delegation = { mode: 'smart-account', owner: SIMPLE_ACCOUNT, account: { kind: 'simple-account', address: SIMPLE_ACCOUNT, factory: FACTORY } };
    const account = { kind: 'simple-account', address: SIMPLE_ACCOUNT, factory: FACTORY } as const;

    expect(builtFee(1, account)).toBeGreaterThan(builtFee(1));
    expect((await exact(ONE_ETH / 2n, { delegation }, '0x')).grossAmount).toBe(ONE_ETH / 2n + builtFee(1, account));
    // Once deployed, the factory is not used and costs nothing.
    expect((await exact(ONE_ETH / 2n, { delegation }, '0x6000')).grossAmount).toBe(ONE_ETH / 2n + builtFee(1));
  });
});
