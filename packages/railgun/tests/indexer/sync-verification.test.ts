import { describe, expect, it, vi } from 'vitest';
import { EthereumProvider, TxLog } from '@kohaku-eth/provider';
import { MerkleTree } from '../../src/railgun/logic/logic/merkletree';
import { createRpcSync } from '../../src/indexer/sync';
import { MerkleRootVerificationError } from '../../src/verification/verifyMerkleRoot';

describe('createRpcSync verification safety', () => {
  it('does not persist state when verification fails during checkpoint save', async () => {
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(1001n),
      getLogs: vi.fn().mockResolvedValue([{} as TxLog]),
      request: vi.fn().mockResolvedValue(`0x${'00'.padStart(64, '0')}`),
    } as unknown as EthereumProvider;

    const mockTree = {
      root: Uint8Array.from([1]),
      rebuildSparseTree: vi.fn().mockResolvedValue(undefined),
    } as unknown as MerkleTree;

    const saveTrees = vi.fn().mockResolvedValue(undefined);
    const setEndBlock = vi.fn();
    const processLog = vi.fn().mockResolvedValue(undefined);
    const trees = [mockTree];

    const rpcSync = await createRpcSync({
      provider,
      processLog,
      getTrees: () => trees,
      getCurrentBlock: () => 0,
      network: {
        RAILGUN_ADDRESS: '0x0000000000000000000000000000000000000001',
      } as never,
      saveTrees,
      setEndBlock,
      accounts: [],
    });

    await expect(
      rpcSync.sync({
        fromBlock: 0,
        toBlock: 1001,
        verify: true,
      }),
    ).rejects.toBeInstanceOf(MerkleRootVerificationError);

    expect(mockTree.rebuildSparseTree).toHaveBeenCalled();
    expect(setEndBlock).not.toHaveBeenCalled();
    expect(saveTrees).not.toHaveBeenCalled();
  });
});
