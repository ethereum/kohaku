import { createAsyncThunk } from '@reduxjs/toolkit';

import { IIndexedDepositWithSecrets } from '../../data/interfaces/events.interface';
import { Address } from '../../interfaces/types.interface';
import { ITornadoProver, TornadoProveOutput } from '../../utils/tornado-prover';
import { DUMMY_PROOF, randomFieldElement } from '../../paymaster/simulation';
import { toHex } from 'viem';
import { stateMerkleProofSelector } from '../selectors/merkle.selector';
import { RootState } from '../store';

export interface WithdrawalProofsThunkParams {
  proverFactory: () => Promise<ITornadoProver>;
  deposit: IIndexedDepositWithSecrets;
  recipient: Address;
  relayerAddress: Address;
  fee: bigint;
  /**
   * Gas-estimation stand-in: the real root and bound fields with a random
   * nullifier hash and a dummy proof that only an overridden verifier accepts.
   * Nothing note-specific is revealed and the prover is not run.
   */
  simulation?: boolean;
}

export const withdrawalsProofThunk = createAsyncThunk<
  TornadoProveOutput,
  WithdrawalProofsThunkParams,
  { state: RootState }
>(
  'withdraw/generateProofs',
  async ({ proverFactory, deposit, recipient, relayerAddress, fee, simulation }, { getState }) => {
    const state = getState();

    const { nullifier, salt, nullifierHash } = deposit;

    const { root, siblings, pathIndices } = await stateMerkleProofSelector(
      state,
      deposit.pool,
      deposit.commitment,
    );

    if (simulation) {
      return {
        proof: DUMMY_PROOF,
        args: [
          toHex(root, { size: 32 }),
          toHex(randomFieldElement(), { size: 32 }),
          toHex(recipient, { size: 20 }),
          toHex(relayerAddress, { size: 20 }),
          toHex(fee, { size: 32 }),
          toHex(0n, { size: 32 }),
        ],
      };
    }

    const prover = await proverFactory();

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
  },
);
