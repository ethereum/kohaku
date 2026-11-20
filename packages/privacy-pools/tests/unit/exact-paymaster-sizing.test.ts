import { beforeEach, describe, expect, it, vi } from 'vitest';

import { E_ADDRESS } from '../../src/config';
import type { Address } from '../../src/interfaces/types.interface';
import { computeMinimumViableFee, paymasterBaselineGas } from '../../src/paymaster/fee';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';

const GWEI = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const PRICE = { maxFeePerGas: 13n * GWEI, maxPriorityFeePerGas: GWEI };

// Approved 1 ETH notes: a batch of `amount` spends ceil(amount / 1 ETH) of them.
const fixture = vi.hoisted(() => ({ noteBalance: 10n ** 18n, notesHeld: 4 }));

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
const builtFee = (noteCount: number) => computeMinimumViableFee(paymasterBaselineGas(false, noteCount, false), PRICE.maxFeePerGas);

const manager = () => storeStateManager({
  entrypoint: { address: 900n, deploymentBlock: 0n },
  dataService: { getChainId: async () => 1n },
  secretManager: {},
  paymasterConfig: { 1: { bundlerUrl: 'https://bundler.test/rpc', paymasterAddress: '0x000000000000000000000000000000000000fee1' } },
  provider: {},
} as unknown as StoreFactoryParams);

beforeEach(() => {
  fixture.noteBalance = ONE_ETH;
  fixture.notesHeld = 4;
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
    const sized = await manager().getExactPaymasterAmount({ asset: ETH, requestedNet, batch: true });

    expect(sized).toEqual({ grossAmount: requestedNet + builtFee(2), fee: builtFee(2), noteCount: 2 });
  });

  it('prices the notes the requested net already needs', async () => {
    const requestedNet = 2n * ONE_ETH + 1n;

    expect(await manager().getExactPaymasterAmount({ asset: ETH, requestedNet, batch: true }))
      .toEqual({ grossAmount: requestedNet + builtFee(3), fee: builtFee(3), noteCount: 3 });
  });

  it('prices one note without batch, whatever the amount', async () => {
    const requestedNet = ONE_ETH - builtFee(1) / 2n;

    expect(await manager().getExactPaymasterAmount({ asset: ETH, requestedNet }))
      .toEqual({ grossAmount: requestedNet + builtFee(1), fee: builtFee(1), noteCount: 1 });
  });

  it('fails when the fee-inclusive gross needs more notes than are held', async () => {
    fixture.notesHeld = 1;

    await expect(manager().getExactPaymasterAmount({ asset: ETH, requestedNet: ONE_ETH - builtFee(1) / 2n, batch: true }))
      .rejects.toThrow('not enough notes');
  });
});
