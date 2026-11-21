import { createMimcMerkleTreeNodejsParallel, type MerkleTree } from '@kohaku-eth/mimc-tree';

export { generateMimcMerkleProof } from '@kohaku-eth/mimc-tree';

export const buildTree = async (leaves: bigint[]): Promise<MerkleTree> => {
    return createMimcMerkleTreeNodejsParallel(leaves);
}
