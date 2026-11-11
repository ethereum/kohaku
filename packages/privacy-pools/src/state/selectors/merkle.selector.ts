import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { INote, } from '../../plugin/interfaces/protocol-params.interface';
import { Secret } from '../../account/keys';
import { commitment } from '../../utils';
import { poolCommitmentsSelector } from './pools.selector';
import { aspSelector, entrypointInfoSelector } from './slices.selectors';
import { Commitment } from '../../interfaces/types.interface';
import { buildMerkleTree, type MerkleTreeBuilder, proofFromTree } from '../../utils/proof.util';
import { getIncrementalTree } from './merkle-tree.cache';

export type MerkleProof = {
  index: number;
  root: bigint;
  siblings: bigint[];
};

export const stateLeavesSelector = createSelector(
  [poolCommitmentsSelector],
  (_commitments): Commitment[] => {
    // poolCommitmentsSelector is a Set that was previously sorted by block number
    return Array.from(_commitments);
  }
);


// Returns synced asp leaves
export const aspLeavesSelector = createSelector(
  [(state: RootState) => state.asp],
  (asp): bigint[] => {
    return asp.leaves.map(BigInt);
  }
);

// State Merkle proof selector - parameterized by pool + note. The tree is cached
// per pool (see merkle-tree.cache), so repeated proofs reuse one built tree.
/**
 * MUST ONLY BE USED IN THUNKS
 */
export const stateMerkleProofSelector = createSelector(
  [
    stateLeavesSelector,
    (_state: RootState, poolAddress: bigint) => poolAddress,
    (_state: RootState, _poolAddress: bigint, note: INote & Secret) => note,
    (_state: RootState, _poolAddress: bigint, _note: INote & Secret, builder: MerkleTreeBuilder = buildMerkleTree) => builder,
  ],
  async (stateLeaves, poolAddress, note, builder): Promise<MerkleProof> => {
    const tree = await getIncrementalTree('state', String(poolAddress), stateLeaves, undefined, builder);

    return proofFromTree(tree, commitment(note));
  }
);

// The ASP tree is cached per entrypoint (see merkle-tree.cache) and checked
// against the root syncAspThunk rebuilt from the same leaves.
const aspTree = (aspLeaves: bigint[], entrypointAddress: bigint, aspTreeRoot: bigint, builder: MerkleTreeBuilder) =>
  getIncrementalTree('asp', String(entrypointAddress), aspLeaves, aspTreeRoot, builder);

/**
 * Root of the tree built from the synced ASP leaves (0n when there are none).
 * This, never a root an ASP service reported, is what is checked against the
 * Entrypoint and what withdrawal proofs are built against.
 *
 * MUST ONLY BE USED IN THUNKS
 */
export const aspLeavesRootSelector = createSelector(
  [aspLeavesSelector, entrypointInfoSelector, aspSelector,
    (_state: RootState, builder: MerkleTreeBuilder = buildMerkleTree) => builder],
  async (aspLeaves, { entrypointAddress }, { aspTreeRoot }, builder): Promise<bigint> =>
    aspLeaves.length === 0 ? 0n : (await aspTree(aspLeaves, entrypointAddress, aspTreeRoot, builder)).root,
);

// ASP Merkle proof selector - parameterized by label.
/**
 * MUST ONLY BE USED IN THUNKS
 */
export const aspMerkleProofSelector = createSelector(
  [
    aspLeavesSelector,
    entrypointInfoSelector,
    aspSelector,
    (_state: RootState, label: bigint) => label,
    (_state: RootState, _label: bigint, builder: MerkleTreeBuilder = buildMerkleTree) => builder,
  ],
  async (aspLeaves, { entrypointAddress }, { aspTreeRoot }, label, builder): Promise<MerkleProof> =>
    proofFromTree(await aspTree(aspLeaves, entrypointAddress, aspTreeRoot, builder), label),
);
