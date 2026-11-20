import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { generateMimcMerkleProof, type MimcMerkleProof } from '@kohaku-eth/mimc-tree';
import { poolCommitmentsSelector, poolMerkleTreeSelector } from './pools.selector';
import { Address, Commitment } from '../../interfaces/types.interface';

export const stateLeavesSelector = createSelector(
  [poolCommitmentsSelector],
  (_commitments): Commitment[] => {
    // poolCommitmentsSelector is a Set that was previously sorted by block number
    return Array.from(_commitments);
  }
);


/**
 * MUST ONLY BE USED IN THUNKS
 */
export const stateMerkleProofSelector = async (
  state: RootState,
  poolAddress: Address,
  commitment: Commitment,
): Promise<MimcMerkleProof> => {
  const tree = await poolMerkleTreeSelector(state, poolAddress);

  return generateMimcMerkleProof(tree, commitment);
};
