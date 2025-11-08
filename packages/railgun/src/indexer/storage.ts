import { ByteUtils } from "~/railgun/lib/utils";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { createBaseStorage, StorageLayer } from "~/storage/base";
import { createEmptyStorageLayer } from "~/storage/layers/empty";

export type CachedMerkleTrees = { tree: string[][], nullifiers: string[] }[];
export type IndexerCache = { trees: MerkleTree[], endBlock: number };
export type IndexerCacheD = { merkleTrees: CachedMerkleTrees, endBlock: number };

export const loadCachedMerkleTrees = async (cachedTrees: CachedMerkleTrees) => {
    if (!cachedTrees) return [];

    const trees: MerkleTree[] = [];

    for (let i = 0; i < cachedTrees.length; i++) {
        const merkleTree = await MerkleTree.createTree(i);

        console.log('merkleTree', merkleTree);
        merkleTree.tree = cachedTrees[i]!.tree.map(level => level.map(hexStringToArray));
        merkleTree.nullifiers = cachedTrees[i]!.nullifiers.map(hexStringToArray);

        trees[i] = merkleTree;
    }

    return trees;
}

export const serializeMerkleTrees = (trees: MerkleTree[]): CachedMerkleTrees => {
    const merkleTrees = [];

    for (const tree of trees) {
        merkleTrees.push({
            tree: tree.tree.map(level => level.map(leaf => ByteUtils.hexlify(leaf, true))),
            nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
        });
    }

    return merkleTrees;
};

export type IndexerLoadData = {
    merkleTrees: CachedMerkleTrees;
    endBlock: number;
};

export const createIndexerStorage = async (
    { startBlock, storage, loadData }: { startBlock?: number; storage?: StorageLayer; loadData?: IndexerLoadData }
) => {
    // Validate: storage and loadData are mutually exclusive
    if (storage !== undefined && loadData !== undefined) {
        throw new Error('Cannot provide both storage and loadData. Use one or the other.');
    }

    const layer = storage || createEmptyStorageLayer();
    const { load, save } = createBaseStorage<IndexerCache, IndexerCacheD>(layer, {
        async parse({ merkleTrees, endBlock }  = { merkleTrees: [], endBlock: startBlock || 0 }) {
            return {
                trees: await loadCachedMerkleTrees(merkleTrees),
                endBlock,
            }
        },
        async serialize({ trees, endBlock }) {
            return { merkleTrees: await serializeMerkleTrees(trees), endBlock: endBlock }
        },
    });

    // Load from loadData if provided, otherwise from storage if available
    const cache = loadData
        ? {
            trees: await loadCachedMerkleTrees(loadData.merkleTrees),
            endBlock: loadData.endBlock,
        }
        : await load();
    
    const saveTrees = () => save(cache);

    return {
        trees: cache.trees,
        getCurrentBlock: () => cache.endBlock,
        setEndBlock: (endBlock: number) => {
            cache.endBlock = endBlock;
        },
        saveTrees,
        [Symbol.asyncDispose]: async () => {
            console.log('disposing base storage');
            saveTrees();
        },
    };
};
