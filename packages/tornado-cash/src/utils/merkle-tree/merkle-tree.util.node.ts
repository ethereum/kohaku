import { generateMimcMerkleProof, createMimcMerkleTreeNodejsParallel, type MerkleTree } from 'mimc-tree';

export const buildTree = async (leaves: bigint[]): Promise<MerkleTree> => {
    return createMimcMerkleTreeNodejsParallel(leaves);
}

export const generateMerkleProof = async (leaves: bigint[], leaf: bigint) => {
    const tree = await buildTree(leaves);

    return generateMimcMerkleProof(tree, leaf);
}