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
// Cache trees, not async selector results: a rejected build or RPC must be retried.
export const stateMerkleProofSelector = async (
  state: RootState,
  poolAddress: bigint,
  note: INote & Secret,
  builder: MerkleTreeBuilder = buildMerkleTree,
): Promise<MerkleProof> => {
  const tree = await getIncrementalTree('state', String(poolAddress), stateLeavesSelector(state, poolAddress), undefined, builder);

  return proofFromTree(tree, commitment(note));
};

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
export const aspLeavesRootSelector = async (state: RootState, builder: MerkleTreeBuilder = buildMerkleTree): Promise<bigint> => {
  const leaves = aspLeavesSelector(state);
  const { entrypointAddress } = entrypointInfoSelector(state);
  const { aspTreeRoot } = aspSelector(state);

  return leaves.length === 0 ? 0n : (await aspTree(leaves, entrypointAddress, aspTreeRoot, builder)).root;
};

// ASP Merkle proof selector - parameterized by label.
/**
 * MUST ONLY BE USED IN THUNKS
 */
export const aspMerkleProofSelector = async (
  state: RootState,
  label: bigint,
  builder: MerkleTreeBuilder = buildMerkleTree,
): Promise<MerkleProof> => {
  const { entrypointAddress } = entrypointInfoSelector(state);
  const { aspTreeRoot } = aspSelector(state);

  return proofFromTree(await aspTree(aspLeavesSelector(state), entrypointAddress, aspTreeRoot, builder), label);
};
