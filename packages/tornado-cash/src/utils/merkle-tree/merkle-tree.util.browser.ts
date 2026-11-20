import { createMimcMerkleTreeParallel, type MerkleTree } from '@kohaku-eth/mimc-tree';

export const buildTree = async (leaves: bigint[]): Promise<MerkleTree> => {
    return createMimcMerkleTreeParallel(leaves, { workerUrl: './merkle-tree-worker.browser.js' });
}
