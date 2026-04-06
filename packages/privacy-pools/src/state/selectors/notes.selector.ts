/* eslint-disable max-lines */
import { createSelector } from '@reduxjs/toolkit';

import { ISecretManager, Secret } from '../../account/keys';
import { Address } from '../../interfaces/types.interface';
import { INote } from '../../plugin/interfaces/protocol-params.interface';
import { createMyDepositsBalanceSelector } from './balance.selector';
import { createMyWithdrawalsSelector } from './withdrawals.selector';

/**
 * Creates a selector that finds the smallest sufficient note for a withdrawal.
 * Returns undefined if no note has sufficient balance.
 */
export const createGetNoteSelector = ({
  myDepositsBalanceSelector,
  myWithdrawalsSelector,
}: {
  myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector>;
  myWithdrawalsSelector: ReturnType<typeof createMyWithdrawalsSelector>;
}) => {
  return createSelector(
    [
      myDepositsBalanceSelector,
      myWithdrawalsSelector,
      (_state: unknown, assetAddress: Address) => assetAddress,
      (_state: unknown, _assetAddress: Address, minAmount: bigint) => minAmount,
    ],
    (depositsMap, withdrawalsMap, assetAddress, minAmount): INote | undefined => {
      // Filter deposits by asset and sufficient balance
      const eligibleDeposits = Array.from(depositsMap.values())
        .filter(deposit => deposit.assetAddress === assetAddress && deposit.balance >= minAmount);

      if (eligibleDeposits.length === 0) {
        return undefined;
      }

      // Sort by balance ascending to get smallest sufficient
      eligibleDeposits.sort((a, b) => Number(a.balance - b.balance));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { commitment, ...bestDeposit } = eligibleDeposits[0]!;

      // Get withdrawal count for this deposit
      const withdrawals = withdrawalsMap.get(bestDeposit.precommitment) || [];
      const withdrawIndex = withdrawals.length;

      return {
        ...bestDeposit,
        deposit: bestDeposit.index,
        withdraw: withdrawIndex,
      };
    }
  );
};

/**
 * Creates a selector that returns all notes for the account.
 */
export const createAllNotesSelector = ({
  myDepositsBalanceSelector,
  myWithdrawalsSelector,
}: {
  myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector>;
  myWithdrawalsSelector: ReturnType<typeof createMyWithdrawalsSelector>;
}) => {
  return createSelector(
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
    }
  );
};

type NextNoteResult = {
  note: INote;
  secrets: Secret;
};

/**
 * Creates a function that computes the next note in a label lineage after a withdrawal.
 * This is not a Redux selector since it doesn't depend on state, only on secretManager.
 */
export const createNextNoteDeriver = ({
  secretManager,
}: {
  secretManager: ISecretManager;
}) => {
  return (
    note: INote,
    withdrawAmount: bigint,
    chainId: bigint,
    entrypointAddress: Address
  ): NextNoteResult => {
    const newBalance = note.balance - withdrawAmount;

    if (newBalance < 0n) {
      throw new Error("Withdrawal amount exceeds note balance");
    }

    // Derive secrets for the next withdrawal index
    const secrets = secretManager.getSecrets({
      entrypointAddress,
      chainId,
      depositIndex: note.deposit,
      withdrawIndex: note.withdraw + 1,
    });

    return {
      note: {
        ...note,
        balance: newBalance,
        withdraw: note.withdraw + 1,
      },
      secrets,
    };
  };
};

/**
 * Creates a deriver function that gets secrets for an existing note.
 * Used to retrieve the secrets needed for spending an existing note in a withdrawal.
 */
export const createExistingNoteSecretsDeriver = ({
  secretManager,
}: {
  secretManager: ISecretManager;
}) => {
  return (
    note: INote,
    chainId: bigint,
    entrypointAddress: Address
  ): Secret => {
    return secretManager.getSecrets({
      entrypointAddress,
      chainId,
      depositIndex: note.deposit,
      withdrawIndex: note.withdraw,
    });
  };
};

/**
 * Creates a selector that returns all unapproved notes with positive balance.
 * These are candidates for ragequit (exit without ASP approval).
 */
export const createUnapprovedNotesSelector = ({
  myDepositsBalanceSelector,
  myWithdrawalsSelector,
}: {
  myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector>;
  myWithdrawalsSelector: ReturnType<typeof createMyWithdrawalsSelector>;
}) => {
  return createSelector(
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
    }
  );
};

/**
 * Creates a selector that filters unapproved notes by asset addresses.
 */
export const createUnapprovedNotesByAssetSelector = ({
  unapprovedNotesSelector,
}: {
  unapprovedNotesSelector: ReturnType<typeof createUnapprovedNotesSelector>;
}) => {
  return createSelector(
    [
      unapprovedNotesSelector,
      (_state: unknown, assets: Address[]) => assets,
    ],
    (notes, assets): INote[] => {
      if (assets.length === 0) {
        return notes; // Return all if no filter
      }

      const assetSet = new Set(assets.map(a => a.toString()));

      return notes.filter(note => assetSet.has(note.assetAddress.toString()));
    }
  );
};
