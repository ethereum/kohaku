import { createAsyncThunk } from '@reduxjs/toolkit';

import { IIndexedDepositWithSecrets } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { ITornadoProver, TornadoProveOutput } from '../../utils/tornado-prover';
import { stateMerkleProofSelector } from '../selectors/merkle.selector';
import { RootState } from '../store';

export interface WithdrawalProofsThunkParams {
  proverFactory: () => Promise<ITornadoProver>;
  deposits: IIndexedDepositWithSecrets[];
  recipient: Address;
  relayerAddress: Address;
  fee: bigint;
}

export const withdrawalsProofThunk = createAsyncThunk<
  TornadoProveOutput[],
  WithdrawalProofsThunkParams,
  { state: RootState }
>(
  'withdraw/generateProofs',
  async ({ proverFactory, deposits, recipient, relayerAddress, fee }, { getState }) => {
    const state = getState();

    const prover = await proverFactory();

    return Promise.all(deposits.map(async (deposit) => {
      const { nullifier, salt, nullifierHash } = deposit
  
      const { root, siblings, pathIndices } = await stateMerkleProofSelector(
        state,
        deposit.pool,
        deposit.commitment,
      );
  
      return prover.prove({
        nullifier,
        secret: salt,
        pathElements: siblings,
        pathIndices,
        root,
        nullifierHash,
        recipient: BigInt(recipient),
        relayer: BigInt(relayerAddress),
        fee,
        refund: 0n,
      });
    }));
  },
);
