import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { encodeRelayData } from '../../src/utils/encoding.utils';

const SYNCED_POOL = 2n;
const ASSET = 0xaan;
const RECIPIENT = 0xbbn;

const fixture = vi.hoisted(() => ({ notes: [] as INote[], prove: vi.fn() }));

vi.mock('../../src/state/selectors/notes.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/notes.selector')>(),
  allNotesSelector: () => fixture.notes,
}));
vi.mock('../../src/state/selectors/pools.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/pools.selector')>(),
  poolFromAssetSelector: () => ({ address: 2n, scope: 1n }),
}));
vi.mock('../../src/state/thunks/quoteThunk', () => ({
  quoteThunk: () => async () => {
    const relayData = { recipient: `0x${'bb'.padStart(40, '0')}` as `0x${string}`,
      feeRecipient: '0x00000000000000000000000000000000000000cc' as const, relayFeeBps: 0n };

    return { meta: { requestStatus: 'fulfilled' }, payload: { quote: { baseFeeBPS: '0', feeCommitment: { withdrawalData: encodeRelayData(relayData) } }, relayerId: 'test', relayData } };
  },
}));
vi.mock('../../src/state/thunks/withdrawThunk', () => ({
  withdrawThunk: (params: unknown) => async () => {
    fixture.prove(params);

    return { payload: { proof: {}, publicSignals: [] } };
  },
}));

const note = (label: bigint, balance: bigint): INote => ({
  balance, value: balance, deposit: Number(label), withdraw: 0, assetAddress: ASSET,
  approved: true, label, precommitment: label, depositor: 5n, blockNumber: 1n,
});

// The Entrypoint's live assetConfig points at `poolAddress`.
const manager = (poolAddress: bigint) => storeStateManager({
  entrypoint: { address: 1n, deploymentBlock: 0n },
  dataService: { getChainId: async () => 1n, getPoolForAsset: async () => ({ poolAddress, maxRelayFeeBPS: 1000n }) },
  secretManager: {},
} as unknown as StoreFactoryParams);

const prepares = {
  relayed: (poolAddress: bigint) => manager(poolAddress).getWithdrawalPayloads({ asset: ASSET, amount: 100n, recipient: RECIPIENT }),
  exact: (poolAddress: bigint) => manager(poolAddress).getExactWithdrawalPayloads({ asset: ASSET, requestedNet: 100n, recipient: RECIPIENT, gasBumpBPS: 0n }),
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.notes = [note(1n, 1000n)];
});

describe('relayed withdrawals bind the live fee config to the synced pool', () => {
  it.each(Object.entries(prepares))('%s: proves against the synced pool when the Entrypoint still points at it', async (_, prepare) => {
    await prepare(SYNCED_POOL);

    expect(fixture.prove).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(prepares))('%s: refuses to prove when the asset\'s pool was replaced since the sync', async (_, prepare) => {
    await expect(prepare(3n)).rejects.toThrow("The Entrypoint's pool for asset 170 is not the synced one");

    expect(fixture.prove).not.toHaveBeenCalled();
  });
});
