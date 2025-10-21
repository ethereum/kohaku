import { TREE_MAX_ITEMS } from '../models/merkletree-types';

// For reference:
export const GLOBAL_UTXO_TREE_UNSHIELD_EVENT_HARDCODED_VALUE = 99999;
export const GLOBAL_UTXO_POSITION_UNSHIELD_EVENT_HARDCODED_VALUE = 99999;
export const GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE = 199999;
export const GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE = 199999;

export const getGlobalTreePosition = (tree: number, index: number): bigint => {
  return BigInt(tree * TREE_MAX_ITEMS + index);
};

export const getGlobalTreePositionPreTransactionPOIProof = (): bigint => {
  return getGlobalTreePosition(
    GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
    GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
  );
};
