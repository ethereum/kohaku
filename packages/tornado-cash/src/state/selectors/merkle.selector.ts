import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { poolCommitmentsSelector } from './pools.selector';
import { Commitment } from '../../interfaces/types.interface';
import { generateMerkleProof } from '../../utils/proof.util';

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
export const stateMerkleProofSelector = createSelector(
  [
    stateLeavesSelector,
    (_state: RootState, _poolAddress: bigint, commitment: Commitment) => commitment,
  ],
  async (stateLeaves, commitment: Commitment) => {
    const start = new Date();
    const proof = await generateMerkleProof(stateLeaves, commitment);
    const end = new Date();
  
    console.log(`Merkle tree for ${stateLeaves.length} leaves took ${ +end - +start }ms`);

    return proof;
  }
);
