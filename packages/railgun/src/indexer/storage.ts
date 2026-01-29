import { ByteUtils } from "~/railgun/lib/utils";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { createBaseStorage, StorageLayer } from "~/storage/base";
import { createEmptyStorageLayer } from "~/storage/layers/empty";

export type CachedMerkleTrees = ({ tree: (string | null)[][], nullifiers: string[] } | null)[];
export type IndexerCache = { trees: (MerkleTree | undefined)[], endBlock: number };
export type IndexerCacheD = { merkleTrees: CachedMerkleTrees, endBlock: number };

export const loadCachedMerkleTrees = async (cachedTrees: CachedMerkleTrees) => {
    if (!cachedTrees) return [];

    const trees: (MerkleTree | undefined)[] = [];

    for (let i = 0; i < cachedTrees.length; i++) {
        const cached = cachedTrees[i];

        // Handle null entries to preserve sparse array indices
        if (!cached) {
            trees[i] = undefined;
            continue;
        }

        const merkleTree = await MerkleTree.createTree(i);

        console.log('merkleTree', merkleTree);
        // Handle null entries within tree levels (sparse merkle tree)
        // Preserve sparse array structure - only assign non-null leaves at their indices
        merkleTree.tree = cached.tree.map(level => {
            const result: Uint8Array[] = [];

            for (let j = 0; j < level.length; j++) {
                if (level[j]) {
                    result[j] = hexStringToArray(level[j]!);
                }
            }

            return result;
        });
        merkleTree.nullifiers = cached.nullifiers.map(hexStringToArray);

        // Rebuild intermediate levels if only leaves were cached
        // Find max leaf index and rebuild the sparse tree
        const leaves = merkleTree.tree[0];

        if (leaves && leaves.length > 0) {
            // Find highest populated leaf index
            let maxIndex = -1;

            for (let j = leaves.length - 1; j >= 0; j--) {
                if (leaves[j]) {
                    maxIndex = j;
                    break;
                }
            }

            if (maxIndex >= 0) {
                // @ts-expect-error setting private property for cache rebuild
                merkleTree.maxLeafIndex = maxIndex;
                await merkleTree.rebuildSparseTree();
            }
        }

        trees[i] = merkleTree;
    }

    return trees;
}

export const serializeMerkleTrees = (trees: (MerkleTree | null | undefined)[]): CachedMerkleTrees => {
    const merkleTrees: CachedMerkleTrees = [];

    // Use index-based loop to preserve sparse array indices
    for (let i = 0; i < trees.length; i++) {
        const tree = trees[i];

        if (!tree) {
            // Preserve null/undefined entries to maintain tree index mapping
            merkleTrees[i] = null;
            continue;
        }

        merkleTrees[i] = {
            // Handle sparse tree levels - preserve indices, only serialize non-empty leaves
            tree: tree.tree.map(level => {
                const result: (string | null)[] = [];

                for (let j = 0; j < level.length; j++) {
                    const leaf = level[j];

                    result[j] = leaf ? ByteUtils.hexlify(leaf, true) : null;
                }

                return result;
            }),
            nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
        };
    }

    return merkleTrees;
};

export type IndexerLoadData = {
    merkleTrees: CachedMerkleTrees;
    endBlock: number;
};

export const createIndexerStorage = async (
    { startBlock, storage, loadState }: { startBlock?: number; storage?: StorageLayer; loadState?: IndexerLoadData }
) => {
    // Validate: storage and loadState are mutually exclusive
    if (storage !== undefined && loadState !== undefined) {
        throw new Error('Cannot provide both storage and loadState. If defining storage, write loadState to storage file');
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

    // Load from loadState if provided, otherwise from storage if available
    const cache = loadState
        ? {
            trees: await loadCachedMerkleTrees(loadState.merkleTrees),
            endBlock: loadState.endBlock,
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
