import { MerkleTree } from "~/railgun/logic/logic/merkletree";

export type GetMerkleRootFn = (treeIndex: number) => Uint8Array<ArrayBufferLike>;
export type GetLatestMerkleRootFn = () => Uint8Array<ArrayBufferLike>;
export type GetMerkleRoot = {
    getMerkleRoot: GetMerkleRootFn,
    getLatestMerkleRoot: GetLatestMerkleRootFn,
};

export type GetMerkleRootFnParams = {
    trees: MerkleTree[];
};

export const makeGetMerkleRoot = ({ trees }: GetMerkleRootFnParams) => ({
    getMerkleRoot(treeIndex: number) {
        if (!trees[treeIndex]) {
            throw new Error('tree index DNE');
        }
    
        return trees[treeIndex].root;
    },
    getLatestMerkleRoot() {
        return trees[trees.length - 1]!.root;
    }
})
