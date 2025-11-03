import { MerkleTree } from "~/railgun/logic/logic/merkletree";

export type GetMerkleRootFn = (
  treeIndex: number
) => Uint8Array<ArrayBufferLike>;
export type GetLatestMerkleRootFn = () => Uint8Array<ArrayBufferLike>;
export type GetMerkleRoot = {
  getMerkleRoot: GetMerkleRootFn;
  getLatestMerkleRoot: GetLatestMerkleRootFn;
};

export type GetMerkleRootFnParams = {
  getTrees: () => MerkleTree[];
};

export const makeGetMerkleRoot = ({ getTrees }: GetMerkleRootFnParams) => ({
  getMerkleRoot(treeIndex: number) {
    if (!getTrees()[treeIndex]) {
      throw new Error("tree index DNE");
    }

    return getTrees()[treeIndex]!.root;
  },
  getLatestMerkleRoot() {
    return getTrees()[getTrees().length - 1]!.root;
  },
});
