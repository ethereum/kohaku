import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRelayData } from '../../src/utils/encoding.utils';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { PPv1AmountObfuscationError } from '../../src/withdrawal/batch-plan';
import { PPv1NoteUnavailableError } from '../../src/withdrawal/note-label';
import { createMockHost } from '../utils/mock-host';

const fixture = vi.hoisted(() => ({ notes: [] as INote[], prepare: vi.fn(), prove: vi.fn() }));

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

const note = (label: bigint, balance: bigint, overrides: Partial<INote> = {}): INote => ({
  balance, value: balance, deposit: Number(label), withdraw: 0, assetAddress: BigInt(ASSET.contract),
  approved: true, label, precommitment: label, depositor: 5n, blockNumber: 1n, ...overrides,
});

function setup() {
  const stateManager = storeStateManager({
    entrypoint: { address: 1n, deploymentBlock: 0n },
    dataService: { getChainId: async () => 1n, getPoolForAsset: async () => ({ maxRelayFeeBPS: 1000n }) },
    secretManager: {},
    paymasterConfig: { 1: { bundlerUrl: 'unused', poolsAccountsMap: {} } },
  } as unknown as StoreFactoryParams);

  vi.spyOn(stateManager, 'sync').mockResolvedValue();
  vi.spyOn(stateManager, 'getUnshieldEstimate').mockResolvedValue({ mode: 'paymaster', fee: 10n, netAmount: 100n, gasFeeWei: 10n, maxFeePerGas: 1n });

  return new PrivacyPoolsV1Protocol(createMockHost(), {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    secretManager: () => ({}) as never,
    stateManager: () => stateManager,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.notes = [
    note(1n, 1000n),
    note(2n, 500n),
    note(3n, 2000n, { approved: false }),
    note(4n, 800n, { assetAddress: 0xddn }),
  ];
});

describe('unshield from a chosen note', () => {
  it.each([false, true])('relayer proves the labelled note over a smaller sufficient one, exact=%s', async exact => {
    await setup().prepareUnshield({ asset: ASSET, amount: 400n }, RECIPIENT,
      { mode: 'relayer', label: 1n, ...(exact ? { exact: {} } : {}) });

    expect(fixture.prove).toHaveBeenCalledWith(expect.objectContaining({ amount: 400n, note: fixture.notes[0] }));
  });

  it('paymaster spends only the labelled note', async () => {
    await setup().prepareUnshield({ asset: ASSET, amount: 400n }, RECIPIENT, { mode: 'paymaster', label: 1n });

    expect(fixture.prepare.mock.calls[0]![0].notesToSpend).toEqual([{ note: fixture.notes[0], withdrawnValue: 400n }]);
  });

  it('exact paymaster checks the note against the fee-inclusive gross', async () => {
    const prepare = setup().prepareUnshield({ asset: ASSET, amount: 995n }, RECIPIENT,
      { mode: 'paymaster', label: 1n, exact: {}, refundRecipient: RECIPIENT });

    await expect(prepare).rejects.toBeInstanceOf(PPv1NoteUnavailableError);
    await expect(prepare).rejects.toMatchObject({ label: 1n, reason: 'insufficient-balance', balance: 1000n, required: 1005n });
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it.each([
    [9n, 100n, 'not-found'],
    [4n, 100n, 'wrong-asset'],
    [3n, 100n, 'not-approved'],
    [2n, 501n, 'insufficient-balance'],
  ] as const)('throws instead of falling back: label %s', async (label, amount, reason) => {
    for (const mode of ['relayer', 'paymaster'] as const) {
      await expect(setup().prepareUnshield({ asset: ASSET, amount }, RECIPIENT, { mode, label }))
        .rejects.toMatchObject({ name: 'PPv1NoteUnavailableError', label, reason });
    }

    expect(fixture.prove).not.toHaveBeenCalled();
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('rejects a label combined with batch', async () => {
    await expect(setup().prepareUnshield({ asset: ASSET, amount: 400n }, RECIPIENT, { mode: 'paymaster', batch: true, label: 1n }))
      .rejects.toThrow('cannot be combined with `batch: true`');
    expect(fixture.prepare).not.toHaveBeenCalled();
  });

  it('obfuscates within the labelled note only', async () => {
    const protocol = setup();

    await protocol.prepareUnshield({ asset: ASSET, amount: 900n }, RECIPIENT, { mode: 'paymaster', label: 1n, obfuscateAmounts: true });
    expect(fixture.prepare.mock.calls[0]![0].notesToSpend).toEqual([{ note: fixture.notes[0], withdrawnValue: 900n }]);

    // 980 is above the 97% ceiling of note 1, even though note 2 could absorb the rest.
    await expect(protocol.prepareUnshield({ asset: ASSET, amount: 980n }, RECIPIENT,
      { mode: 'paymaster', label: 1n, obfuscateAmounts: true })).rejects.toBeInstanceOf(PPv1AmountObfuscationError);
  });
});
