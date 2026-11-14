import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRelayData } from '../../src/utils/encoding.utils';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { PPv1AmountObfuscationError } from '../../src/withdrawal/batch-plan';
import { createMockHost } from '../utils/mock-host';

const fixture = vi.hoisted(() => ({ notes: [] as INote[], prepare: vi.fn(), prove: vi.fn(), quote: vi.fn() }));

vi.mock('../../src/state/selectors/notes.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/notes.selector')>(),
  allNotesSelector: () => fixture.notes,
}));
vi.mock('../../src/state/selectors/pools.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/pools.selector')>(),
  poolFromAssetSelector: () => ({ address: 2n, scope: 1n }),
}));
vi.mock('../../src/state/thunks/quoteThunk', () => ({
  quoteThunk: (params: { recipient: bigint }) => async () => {
    fixture.quote(params);
    const relayData = { recipient: `0x${params.recipient.toString(16).padStart(40, '0')}` as `0x${string}`,
      feeRecipient: '0x00000000000000000000000000000000000000cc' as const, relayFeeBps: 0n };

    return { meta: { requestStatus: 'fulfilled' }, payload: { quote: { baseFeeBPS: '0', feeCommitment: { withdrawalData: encodeRelayData(relayData) } }, relayerId: 'test', relayData } };
  },
}));
vi.mock('../../src/state/thunks/withdrawThunk', () => ({
  withdrawThunk: (params: unknown) => async () => {
    fixture.prove(params);

    return { payload: { proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['1', '2', '1'] }, publicSignals: Array(8).fill('0') } };
  },
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
    dataService: { getChainId: async () => 1n, getPoolForAsset: async () => ({ maxRelayFeeBPS: 1000n }) },
    secretManager: {},
    paymasterConfig: { 1: { bundlerUrl: 'unused', poolsAccountsMap: {} } },
  } as unknown as StoreFactoryParams);
  const sync = vi.spyOn(stateManager, 'sync').mockResolvedValue();

  vi.spyOn(stateManager, 'getUnshieldEstimate').mockResolvedValue({ mode: 'paymaster', fee: 10n, netAmount: 100n, gasFeeWei: 10n, maxFeePerGas: 1n });
  const protocol = new PrivacyPoolsV1Protocol(createMockHost(), {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    secretManager: () => ({}) as never,
    stateManager: () => stateManager,
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
  it('preserves exact recipient output while obfuscating the fee-inclusive gross', async () => {
    const { protocol } = setup();
    const operation = await protocol.prepareUnshield({ asset: ASSET, amount: 1930n }, RECIPIENT, {
      mode: 'paymaster', batch: true, obfuscateAmounts: true, exact: {}, refundRecipient: RECIPIENT,
    });

    expect(operation.exact).toMatchObject({ requestedNet: 1930n, grossAmount: 1940n, expectedNet: 1930n, fee: 10n });
    expect(fixture.prepare).toHaveBeenCalledOnce();
    const params = fixture.prepare.mock.calls[0]![0];

    expect(params.amount).toBe(1940n);
    expect(params.notesToSpend.reduce((sum: bigint, n: { withdrawnValue: bigint }) => sum + n.withdrawnValue, 0n)).toBe(1940n);
    expect(params.notesToSpend.every((n: { note: INote; withdrawnValue: bigint }) => n.withdrawnValue < n.note.balance)).toBe(true);
  });

  it('checks headroom after adding exact-output fees', async () => {
    const { protocol } = setup();
    const prepare = protocol.prepareUnshield({ asset: ASSET, amount: 1931n }, RECIPIENT, {
      mode: 'paymaster', batch: true, obfuscateAmounts: true, exact: {}, refundRecipient: RECIPIENT,
    });

    await expect(prepare).rejects.toBeInstanceOf(PPv1AmountObfuscationError);
    await expect(prepare).rejects.toMatchObject({ requestedAmount: 1941n, maxObfuscatedAmount: 1940n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it.each([undefined, false])('permits a full-balance withdrawal without opting in: %s', async obfuscateAmounts => {
    const { protocol } = setup();

    await protocol.prepareUnshield({ asset: ASSET, amount: 2000n }, RECIPIENT, { mode: 'paymaster', batch: true, obfuscateAmounts });
    expect(fixture.prepare.mock.calls[0]![0].notesToSpend).toBeUndefined();
  });

  it('protects a gross request equal to the largest note when explicitly enabled', async () => {
    const { protocol } = setup();

    await protocol.prepareUnshield({ asset: ASSET, amount: 1000n }, RECIPIENT, { mode: 'paymaster', batch: true, obfuscateAmounts: true });
    const notes = fixture.prepare.mock.calls[0]![0].notesToSpend;

    expect(notes).toHaveLength(2);
    expect(notes.reduce((sum: bigint, n: { withdrawnValue: bigint }) => sum + n.withdrawnValue, 0n)).toBe(1000n);
    expect(notes.every((n: { note: INote; withdrawnValue: bigint }) => n.withdrawnValue < n.note.balance)).toBe(true);
  });

  it('rejects a 99.98% request before signed preparation', async () => {
    const { protocol } = setup();

    fixture.notes = fixture.notes.map(note => ({ ...note, balance: 5000n, value: 5000n }));
    await expect(protocol.prepareUnshield({ asset: ASSET, amount: 9998n }, RECIPIENT,
      { mode: 'paymaster', batch: true, obfuscateAmounts: true })).rejects.toMatchObject({ requestedAmount: 9998n, maxObfuscatedAmount: 9700n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it.each(['paymaster', 'relayer'] as const)('rejects a protected multi-note request without a batch-capable path: %s', async mode => {
    const { protocol } = setup();

    await expect(protocol.prepareUnshield({ asset: ASSET, amount: 1000n }, RECIPIENT, { mode, obfuscateAmounts: true }))
      .rejects.toThrow('use paymaster mode with batch: true');
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(fixture.prove).not.toHaveBeenCalled();
    expect(fixture.quote).not.toHaveBeenCalled();
  });

  it.each([false, true])('protects a relayer note when enabled, exact=%s', async exact => {
    const { protocol } = setup();

    await protocol.prepareUnshield({ asset: ASSET, amount: 100n }, RECIPIENT, { mode: 'relayer', obfuscateAmounts: true, ...(exact ? { exact: {} } : {}) });
    expect(fixture.prove).toHaveBeenCalledWith(expect.objectContaining({ amount: 100n, note: fixture.notes[0] }));
  });

  it('uses legacy relayer selection when options are omitted', async () => {
    const { protocol } = setup();

    await protocol.prepareUnshield({ asset: ASSET, amount: 1000n }, RECIPIENT);
    expect(fixture.prove).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000n, note: undefined }));
  });
});
