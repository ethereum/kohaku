import {
    MIMC_MERKLE_TREE_LEVELS,
    createMimcMerkleTree,
    createMimcMerkleTreeParallel,
    type MerkleTree,
} from '@kohaku-eth/mimc-tree';

export { generateMimcMerkleProof } from '@kohaku-eth/mimc-tree';

// Set after the first worker failure. The library keeps its worker pool cached and a
// pool whose workers failed to load never answers again, so later builds must not reuse it.
let workersFailed = false;

const workersAvailable = () => !workersFailed && typeof globalThis.Worker === 'function';

export const buildTree = async (leaves: bigint[]): Promise<MerkleTree> => {
    // Capacity errors are not worker errors: fail before choosing a builder.
    if (leaves.length > 2 ** MIMC_MERKLE_TREE_LEVELS) {
        throw new Error('Tree is full');
    }

    if (workersAvailable()) {
        try {
            return await createMimcMerkleTreeParallel(leaves, { workerUrl: './merkle-tree-worker.browser.js' });
        } catch (error) {
            workersFailed = true;
            console.warn('MiMC tree workers failed, building on the main thread instead:', error);
        }
    }

    return createMimcMerkleTree(leaves);
}
