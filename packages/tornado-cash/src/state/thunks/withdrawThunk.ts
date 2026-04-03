import { Prover, WithdrawPublicSignals } from "@fatsolutions/privacy-pools-core-circuits";
import { createAsyncThunk } from '@reduxjs/toolkit';

import { Secret } from '../../account/keys';
import { Address } from '../../interfaces/types.interface';
import { INote } from '../../plugin/interfaces/protocol-params.interface';
import { aspMerkleProofSelector, stateMerkleProofSelector } from '../selectors/merkle.selector';
import { poolFromAssetSelector } from "../selectors/pools.selector";
import { entrypointInfoSelector } from '../selectors/slices.selectors';
import { RootState } from '../store';

export type ProveOutput = Awaited<ReturnType<Awaited<ReturnType<typeof Prover>>['prove']>>;
export type WithdrawProveOutput = Omit<ProveOutput, 'mappedSignals'> & {
  mappedSignals: WithdrawPublicSignals;
};

export interface WithdrawThunkParams {
  // Selector functions
  getNote: (assetAddress: Address, minAmount: bigint) => INote | undefined;
  getNextNote: (note: INote, withdrawAmount: bigint, chainId: bigint, entrypoint: Address) => { note: INote; secrets: Secret; };
  getExistingNoteSecrets: (note: INote, chainId: bigint, entrypoint: Address) => Secret;
  // Prover factory
  proverFactory: () => ReturnType<typeof Prover>;
  // Withdrawal params
  asset: Address;
  amount: bigint;
  recipient: Address;
  context: bigint;
}

export const withdrawThunk = createAsyncThunk<
  WithdrawProveOutput,
  WithdrawThunkParams,
  { state: RootState; }
>(
  'withdraw/generateProof',
  async (params, { getState }) => {
    const state = getState();
    
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    // 1. Get existing note (smallest sufficient)
    const existingNote = params.getNote(params.asset, params.amount);

    if (!existingNote) {
      throw new Error("No note with sufficient balance for withdrawal");
    }

    // 2. Get existing note's secrets
    const existingSecrets = params.getExistingNoteSecrets(
      existingNote,
      chainId,
      entrypointAddress
    );

    // 3. Get change note with its secrets
    const { secrets: changeSecrets } = params.getNextNote(
      existingNote,
      params.amount,
      chainId,
      entrypointAddress
    );

    const poolInfo = poolFromAssetSelector(state, params.asset)

    if (!poolInfo) {
      throw new Error(`No pool found for asset ${params.asset}`);
    }

    // 4. Get Merkle proofs (selectors parameterized by note/label)
    const existingNoteFull = { ...existingNote, ...existingSecrets };

    const stateMerkleProof = stateMerkleProofSelector(state, poolInfo.address, existingNoteFull);
    const aspMerkleProof = aspMerkleProofSelector(state, existingNote.label);

    // 6. Generate ZK proof
    const prover = await params.proverFactory();

    return prover.prove("withdraw", {
      context: params.context,
      label: existingNote.label,
      existingNullifier: existingSecrets.nullifier,
      existingSecret: existingSecrets.salt,
      existingValue: existingNote.balance,
      newNullifier: changeSecrets.nullifier,
      newSecret: changeSecrets.salt,
      withdrawnValue: params.amount,

      stateIndex: BigInt(stateMerkleProof.index),
      stateRoot: stateMerkleProof.root,
      stateSiblings: stateMerkleProof.siblings,
      stateTreeDepth: 2n,

      ASPIndex: BigInt(aspMerkleProof.index),
      ASPRoot: aspMerkleProof.root,
      ASPSiblings: aspMerkleProof.siblings,
      ASPTreeDepth: 2n,
    });
  }
);
