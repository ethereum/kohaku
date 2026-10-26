import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { INote, } from '../../plugin/interfaces/protocol-params.interface';
import { Secret } from '../../account/keys';
import { commitment } from '../../utils';
import { poolCommitmentsSelector } from './pools.selector';
import { entrypointInfoSelector } from './slices.selectors';
import { Commitment } from '../../interfaces/types.interface';
import { proofFromTree } from '../../utils/proof.util';
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
export const stateMerkleProofSelector = createSelector(
  [
    stateLeavesSelector,
    (_state: RootState, poolAddress: bigint, _note: INote & Secret) => poolAddress,
    (_state: RootState, _poolAddress: bigint, note: INote & Secret) => note,
  ],
  (stateLeaves, poolAddress, note): MerkleProof => {
    const tree = getIncrementalTree('state', String(poolAddress), stateLeaves);
    return proofFromTree(tree, commitment(note));
  }
);

// ASP Merkle proof selector - parameterized by label. The ASP tree is cached per
// entrypoint (see merkle-tree.cache).
export const aspMerkleProofSelector = createSelector(
  [
    aspLeavesSelector,
    entrypointInfoSelector,
    (_state: RootState, label: bigint) => label,
  ],
  (aspLeaves, entrypointInfo, label): MerkleProof => {
    const tree = getIncrementalTree('asp', String(entrypointInfo.entrypointAddress), aspLeaves);
    return proofFromTree(tree, label);
  }
);
