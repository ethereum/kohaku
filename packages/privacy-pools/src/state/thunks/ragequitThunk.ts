import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { createAsyncThunk } from '@reduxjs/toolkit';
import { Secret } from '../../account/keys';
import { Address } from '../../interfaces/types.interface';
import { CommitmentProveOutput, INote } from '../../plugin/interfaces/protocol-params.interface';
import { entrypointInfoSelector } from '../selectors/slices.selectors';
import { RootState } from '../store';
import { poolFromAssetSelector } from "../selectors/pools.selector";

export interface RagequitResult {
  note: INote;
  poolAddress: Address;
  proofResult: CommitmentProveOutput;
}

export interface RagequitThunkParams {
  // The unapproved note to ragequit
  note: INote;
  // Function to get secrets for the note
  getExistingNoteSecrets: (note: INote, chainId: bigint, entrypoint: Address) => Secret;
  // Prover factory
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
  async (params, { getState }) => {
    const state = getState();
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    const { note, getExistingNoteSecrets, proverFactory } = params;

    // 1. Validate note has balance
    if (note.balance <= 0n) {
      throw new Error("Note has no balance to ragequit.");
    }

    // 2. Get the pool for this asset
    const poolInfo = poolFromAssetSelector(state, note.assetAddress);

    if (!poolInfo) {
      throw new Error(`No pool found for asset ${note.assetAddress}`);
    }

    // 3. Get existing note's secrets
    const secrets = getExistingNoteSecrets(
      note,
      chainId,
      entrypointAddress
    );

    // 4. Generate commitment proof
    // The commitment circuit proves knowledge of (value, label, nullifier, secret)
    // and outputs (commitment, nullifierHash, value, label)
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
  }
);
