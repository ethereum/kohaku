import { MerkleTree } from "../../railgun/logic/logic/merkletree.js";

export type GetMerkleRootFn = (treeIndex: number) => Uint8Array<ArrayBufferLike>;
export type GetLatestMerkleRootFn = () => Uint8Array<ArrayBufferLike>;
export type GetMerkleRoot = {
    getMerkleRoot: GetMerkleRootFn,
    getLatestMerkleRoot: GetLatestMerkleRootFn,
};

export type GetMerkleRootFnParams = {
    getTrees: () => (MerkleTree | undefined)[];
};

export const makeGetMerkleRoot = ({ getTrees }: GetMerkleRootFnParams) => ({
    getMerkleRoot(treeIndex: number) {
        if (!getTrees()[treeIndex]) {
            throw new Error('tree index DNE');
        }

        return getTrees()[treeIndex]!.root;
    },
    getLatestMerkleRoot() {
        const trees = getTrees();

        if (trees.length === 0) {
            throw new Error('No merkle trees available. Sync indexer first or load preloaded state.');
        }

        return trees[trees.length - 1]!.root;
    }
})
