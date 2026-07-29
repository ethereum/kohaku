import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { createAsyncThunk } from '@reduxjs/toolkit';
import { Address } from '../../interfaces/types.interface';
import { CommitmentProveOutput, INote } from '../../plugin/interfaces/protocol-params.interface';
import { existingNoteSecretsSelector } from '../selectors/notes.selector';
import { poolFromAssetSelector } from "../selectors/pools.selector";
import { RootState } from '../store';

export interface RagequitResult {
  note: INote;
  poolAddress: Address;
  proofResult: CommitmentProveOutput;
}

export interface RagequitThunkParams {
  note: INote;
  proverFactory: () => ReturnType<typeof Prover>;
}

/**
 * Ragequit thunk generates a commitment proof for exiting unapproved funds.
 *
 * Unlike withdrawThunk:
 * - Uses "commitment" circuit (no Merkle proofs needed)
 * - No relayer involvement (direct on-chain tx)
 * - Only works with unapproved notes
 * - Exits full balance (no partial)
 */
export const ragequitThunk = createAsyncThunk<
  RagequitResult,
  RagequitThunkParams,
  { state: RootState; }
>(
  'ragequit/generateProof',
  async ({ note, proverFactory }, { getState }) => {
    const state = getState();

    if (note.balance <= 0n) {
      throw new Error("Note has no balance to ragequit.");
    }

    const poolInfo = poolFromAssetSelector(state, note.assetAddress);

    if (!poolInfo) {
      throw new Error(`No pool found for asset ${note.assetAddress}`);
    }

    // Get secrets directly from the slice
    const secrets = existingNoteSecretsSelector(state, note);

    const prover = await proverFactory();
    const proofResult = await prover.prove("commitment", {
      value: note.balance,
      label: note.label,
      nullifier: secrets.nullifier,
      secret: secrets.salt,
    });

    return {
      note,
      poolAddress: poolInfo.address,
      proofResult: proofResult as CommitmentProveOutput,
    };
  },
);
