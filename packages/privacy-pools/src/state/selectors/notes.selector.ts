/* eslint-disable max-lines */
import { createSelector } from '@reduxjs/toolkit';

import { ISecretManager, Secret } from '../../account/keys';
import { Address } from '../../interfaces/types.interface';
import { INote } from '../../plugin/interfaces/protocol-params.interface';
import { RootState } from '../store';
import { myDepositsBalanceSelector } from './balance.selector';
import { userSecretsSelector } from './slices.selectors';
import { myWithdrawalsSelector } from './withdrawals.selector';

/**
 * Finds the smallest sufficient note for a withdrawal.
 * Returns undefined if no note has sufficient balance.
 */
export const getNoteSelector = createSelector(
  [
    myDepositsBalanceSelector,
    myWithdrawalsSelector,
    (_state: unknown, assetAddress: Address) => assetAddress,
    (_state: unknown, _assetAddress: Address, minAmount: bigint) => minAmount,
  ],
  (depositsMap, withdrawalsMap, assetAddress, minAmount): INote | undefined => {
    const eligibleDeposits = Array.from(depositsMap.values())
      .filter(deposit => deposit.assetAddress === assetAddress && deposit.balance >= minAmount);

    if (eligibleDeposits.length === 0) {
      return undefined;
    }

    eligibleDeposits.sort((a, b) => Number(a.balance - b.balance));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { commitment, ...bestDeposit } = eligibleDeposits[0]!;
    const withdrawals = withdrawalsMap.get(bestDeposit.precommitment) || [];
    const withdrawIndex = withdrawals.length;

    return {
      ...bestDeposit,
      deposit: bestDeposit.index,
      withdraw: withdrawIndex,
    };
  },
);

/**
 * Returns all notes for the account.
 */
export const allNotesSelector = createSelector(
  [myDepositsBalanceSelector, myWithdrawalsSelector],
  (depositsMap, withdrawalsMap): INote[] => {
    return Array.from(depositsMap.values()).map(deposit => ({
      label: deposit.label,
      precommitment: deposit.precommitment,
      commitment: deposit.commitment,
      value: deposit.value,
      balance: deposit.balance,
      assetAddress: deposit.assetAddress,
      approved: deposit.approved,
      deposit: deposit.index,
      withdraw: (withdrawalsMap.get(deposit.precommitment) || []).length,
    }));
  },
);

/**
 * Returns secrets for an existing note by reading directly from the userSecrets slice.
 * No secretManager required.
 */
export const existingNoteSecretsSelector = (state: RootState, note: INote): Secret => {
  const userSecretsMap = userSecretsSelector(state);
  const record = userSecretsMap.get(note.precommitment);

  if (!record) {
    throw new Error(`No user secret found for precommitment ${note.precommitment}`);
  }

  const ns = record.noteSecrets[note.withdraw];

  if (!ns) {
    throw new Error(`No note secret at withdraw index ${note.withdraw} for deposit ${record.depositIndex}`);
  }

  return { nullifier: ns.nullifier, salt: ns.salt, precommitment: ns.precommitment, nullifierHash: ns.nullifierHash };
};

type NextNoteResult = {
  note: INote;
  secrets: Secret;
};

/**
 * Creates an async deriver that computes the next note in a label lineage after a withdrawal.
 * Remains a factory because it derives secretIndex N+1 which is not yet stored in the slice.
 */
export const createNextNoteDeriver = ({
  secretManager,
}: {
  secretManager: ISecretManager;
}) => {
  return async (
    note: INote,
    withdrawAmount: bigint,
    chainId: bigint,
    entrypointAddress: Address,
  ): Promise<NextNoteResult> => {
    const newBalance = note.balance - withdrawAmount;

    if (newBalance < 0n) {
      throw new Error("Withdrawal amount exceeds note balance");
    }

    const secrets = await secretManager.getSecrets({
      entrypointAddress,
      chainId,
      depositIndex: note.deposit,
      withdrawIndex: note.withdraw + 1,
    });

    return {
      note: { ...note, balance: newBalance, withdraw: note.withdraw + 1 },
      secrets,
    };
  };
};

/**
 * Returns all unapproved notes with positive balance (candidates for ragequit).
 */
export const unapprovedNotesSelector = createSelector(
  [myDepositsBalanceSelector, myWithdrawalsSelector],
  (depositsMap, withdrawalsMap): INote[] => {
    return Array.from(depositsMap.values())
      .filter(deposit => !deposit.approved && deposit.balance > 0n)
      .map(deposit => ({
        label: deposit.label,
        precommitment: deposit.precommitment,
        value: deposit.value,
        balance: deposit.balance,
        assetAddress: deposit.assetAddress,
        approved: deposit.approved,
        deposit: deposit.index,
        withdraw: (withdrawalsMap.get(deposit.precommitment) || []).length,
      }));
  },
);

/**
 * Filters unapproved notes by asset addresses.
 */
export const unapprovedNotesByAssetSelector = createSelector(
  [
    unapprovedNotesSelector,
    (_state: unknown, assets: Address[]) => assets,
  ],
  (notes, assets): INote[] => {
    if (assets.length === 0) {
      return notes;
    }

    const assetSet = new Set(assets.map(a => a.toString()));

    return notes.filter(note => assetSet.has(note.assetAddress.toString()));
  },
);
