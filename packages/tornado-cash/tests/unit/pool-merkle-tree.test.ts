import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMimcMerkleTree, generateMimcMerkleProof } from '@kohaku-eth/mimc-tree';
import { buildTree } from '#merkle-tree';
import { TornadoCashConfigs } from '../../src/config';
import type { IDepositEvent, IPool } from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { stateMerkleProofSelector } from '../../src/state/selectors/merkle.selector';
import { poolMerkleTreeRootSelector } from '../../src/state/selectors/pools.selector';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerWithdrawals } from '../../src/state/slices/withdrawalsSlice';
import { storeFactory } from '../../src/state/store';

// Count builds while still hashing a real tree, without starting workers.
vi.mock('#merkle-tree', async () => ({
  buildTree: vi.fn(),
  generateMimcMerkleProof: (await import('@kohaku-eth/mimc-tree')).generateMimcMerkleProof,
}));

const poolAddress = 1000n as Address;
const poolAddress2 = 2000n as Address;
const makeStore = () => storeFactory({ logLevel: 'off', protocolConfig: TornadoCashConfigs[1] });
const pool = (address: Address): IPool => ({
  address,
  asset: 0n,
  isERC20: false,
  denomination: 10n ** 18n,
  protocolFeePercentage: 0,
  registeredBlock: 0n,
  state: 1,
  rootHistorySize: 100,
});
const deposits = (address: Address, leaves: bigint[], firstIndex = 0): IDepositEvent[] =>
  leaves.map((commitment, i) => ({
    pool: address,
    commitment,
    leafIndex: firstIndex + i,
    timestamp: 0n,
    blockNumber: BigInt(firstIndex + i + 1),
    transactionHash: 0n,
  }));
const leaves = [11n, 22n, 33n, 44n];

describe('pool Merkle tree reuse', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildTree).mockImplementation(async (treeLeaves) => createMimcMerkleTree(treeLeaves));
  });

  it('builds one tree for root verification and every proof from the same pool', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));
    store.dispatch(registerDeposits(deposits(poolAddress, leaves)));

    const state = store.getState();
    const root = await poolMerkleTreeRootSelector(state, poolAddress);
    const proofs = await Promise.all(
      leaves.slice(0, 3).map((leaf) => stateMerkleProofSelector(state, poolAddress, leaf)),
    );
    const expected = createMimcMerkleTree(leaves);

    expect(buildTree).toHaveBeenCalledTimes(1);
    expect(root).toBe(BigInt(expected.root));
    proofs.forEach((proof, i) => {
      expect(proof).toEqual(generateMimcMerkleProof(expected, leaves[i]!));
    });
  });

  it('keeps the tree when only withdrawals change and rebuilds when deposits change', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress), pool(poolAddress2)]));
    store.dispatch(registerDeposits(deposits(poolAddress, leaves.slice(0, 2))));
    await stateMerkleProofSelector(store.getState(), poolAddress, leaves[0]!);

    store.dispatch(registerWithdrawals([{
      pool: poolAddress,
      nullifierHash: 1n,
      to: 1n as Address,
      relayer: 0n as Address,
      fee: 0n,
      blockNumber: 10n,
      transactionHash: 0n,
    }]));
    await stateMerkleProofSelector(store.getState(), poolAddress, leaves[1]!);
    expect(buildTree).toHaveBeenCalledTimes(1);

    store.dispatch(registerDeposits(deposits(poolAddress, leaves.slice(2), 2)));

    const proof = await stateMerkleProofSelector(store.getState(), poolAddress, leaves[3]!);

    expect(buildTree).toHaveBeenCalledTimes(2);
    expect(buildTree).toHaveBeenLastCalledWith(leaves);
    expect(proof.root).toBe(BigInt(createMimcMerkleTree(leaves).root));
  });

  it('does not cache a failed build', async () => {
    const store = makeStore();

    store.dispatch(registerPools([pool(poolAddress)]));
    store.dispatch(registerDeposits(deposits(poolAddress, leaves)));
    vi.mocked(buildTree).mockRejectedValueOnce(new Error('worker failed'));

    const state = store.getState();

    await expect(poolMerkleTreeRootSelector(state, poolAddress)).rejects.toThrow('worker failed');
    await expect(poolMerkleTreeRootSelector(state, poolAddress))
      .resolves.toBe(BigInt(createMimcMerkleTree(leaves).root));
    expect(buildTree).toHaveBeenCalledTimes(2);
  });
});
