import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { INote, } from '../../plugin/interfaces/protocol-params.interface';
import { Secret } from '../../account/keys';
import { commitment } from '../../utils';
import { poolCommitmentsSelector } from './pools.selector';
import { Commitment } from '../../interfaces/types.interface';
import { generateMerkleProof } from '../../utils/proof.util';

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


// State Merkle proof selector - parameterized by note
export const stateMerkleProofSelector = createSelector(
  [
    stateLeavesSelector,
    (_state: RootState, _poolAddress: bigint, note: INote & Secret) => note,
  ],
  (stateLeaves, note): MerkleProof => {
    return generateMerkleProof(stateLeaves, commitment(note));
  }
);
