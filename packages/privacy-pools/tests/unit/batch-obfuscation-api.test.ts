import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { INote, IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { PPv1AmountObfuscationError } from '../../src/withdrawal/batch-plan';
import { createMockHost } from '../utils/mock-host';

const fixture = vi.hoisted(() => ({ notes: [] as INote[], prepare: vi.fn() }));
vi.mock('../../src/state/selectors/notes.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/notes.selector')>(),
  allNotesSelector: () => fixture.notes,
}));
vi.mock('../../src/state/thunks/paymasterWithdrawThunk', () => ({
  paymasterWithdrawThunk: (params: unknown) => async () => {
    fixture.prepare(params);
    return { payload: [{ mode: 'paymaster', fee: 10n }] };
  },
}));

const ASSET = { __type: 'erc20', contract: '0x00000000000000000000000000000000000000aa' } as const;
const RECIPIENT = '0x00000000000000000000000000000000000000bb';
function setup() {
  const stateManager = storeStateManager({
    entrypoint: { address: 1n, deploymentBlock: 0n },
    dataService: { getChainId: async () => 1n },
    secretManager: {},
    paymasterConfig: { 1: { bundlerUrl: 'unused', poolsAccountsMap: {} } },
  } as unknown as StoreFactoryParams);
  const sync = vi.spyOn(stateManager, 'sync').mockResolvedValue();
  vi.spyOn(stateManager, 'getNotes').mockImplementation(async () => fixture.notes);
  vi.spyOn(stateManager, 'getUnshieldEstimate').mockResolvedValue({ mode: 'paymaster', fee: 10n, netAmount: 100n, gasFeeWei: 10n, maxFeePerGas: 1n });
  const protocol = new PrivacyPoolsV1Protocol(createMockHost(), {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    secretManager: () => ({}) as never,
    stateManager: () => stateManager as IStateManager,
  });
  return { protocol, stateManager, sync };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.notes = [1000n, 1000n].map((balance, deposit) => ({
    balance, value: balance, deposit, withdraw: 0, assetAddress: BigInt(ASSET.contract),
    approved: true, label: BigInt(deposit + 1), precommitment: BigInt(deposit + 1), depositor: 5n, blockNumber: 1n,
  }));
});

describe('batch amount obfuscation API', () => {
  it('previews full spends after sync without preparing a signed operation', async () => {
    const { protocol, stateManager, sync } = setup();
    const preview = await protocol.previewBatchUnshield({ asset: ASSET, amount: 2000n });
    expect(sync).toHaveBeenCalledOnce();
    expect(stateManager.getNotes).toHaveBeenCalledWith({ assets: [BigInt(ASSET.contract)] });
    expect(preview).toMatchObject({ amount: 2000n, fullySpentNoteCount: 2, suggestedAmount: 1900n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('passes one resolved allocation to the paymaster without changing the requested gross', async () => {
    const { protocol } = setup();
    await protocol.prepareUnshield({ asset: ASSET, amount: 1900n }, RECIPIENT, { mode: 'paymaster', batch: true, obfuscateAmounts: true });
    expect(fixture.prepare).toHaveBeenCalledOnce();
    const params = fixture.prepare.mock.calls[0]![0];
    expect(params.amount).toBe(1900n);
    expect(params.notesToSpend.reduce((sum: bigint, n: { withdrawnValue: bigint }) => sum + n.withdrawnValue, 0n)).toBe(1900n);
    expect(params.notesToSpend.every((n: { changeValue: bigint }) => n.changeValue > 0n)).toBe(true);
  });

  it('preserves the structured headroom error before any signed preparation', async () => {
    const { protocol } = setup();
    const prepare = protocol.prepareUnshield({ asset: ASSET, amount: 2000n }, RECIPIENT, { mode: 'paymaster', batch: true, obfuscateAmounts: true });
    await expect(prepare).rejects.toBeInstanceOf(PPv1AmountObfuscationError);
    await expect(prepare).rejects.toMatchObject({ requestedAmount: 2000n, maxObfuscatedAmount: 1980n, suggestedAmount: 1900n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('preserves exact recipient output while obfuscating the fee-inclusive gross', async () => {
    const { protocol } = setup();
    const operation = await protocol.prepareUnshield({ asset: ASSET, amount: 1890n }, RECIPIENT, {
      mode: 'paymaster', batch: true, obfuscateAmounts: true, exact: {}, refundRecipient: RECIPIENT,
    });
    expect(operation.exact).toMatchObject({ requestedNet: 1890n, grossAmount: 1900n, expectedNet: 1890n, fee: 10n });
    expect(fixture.prepare.mock.calls[0]![0].amount).toBe(1900n);
  });

  it('checks headroom after adding exact-output fees', async () => {
    const { protocol } = setup();
    await expect(protocol.prepareUnshield({ asset: ASSET, amount: 1980n }, RECIPIENT, {
      mode: 'paymaster', batch: true, obfuscateAmounts: true, exact: {}, refundRecipient: RECIPIENT,
    })).rejects.toMatchObject({ requestedAmount: 1990n, maxObfuscatedAmount: 1980n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('leaves the default allocator available for explicit full-balance withdrawals', async () => {
    const { protocol } = setup();
    await protocol.prepareUnshield({ asset: ASSET, amount: 2000n }, RECIPIENT, { mode: 'paymaster', batch: true });
    expect(fixture.prepare.mock.calls[0]![0].notesToSpend).toBeUndefined();
  });

  it.each([{ mode: 'paymaster' }, { mode: 'relayer', batch: true }])('rejects unsupported options before syncing: %o', async options => {
    const { protocol, sync } = setup();
    await expect(protocol.prepareUnshield({ asset: ASSET, amount: 1900n }, RECIPIENT,
      { ...options, obfuscateAmounts: true } as never)).rejects.toThrow('requires paymaster mode and batch: true');
    expect(sync).not.toHaveBeenCalled();
  });
});
