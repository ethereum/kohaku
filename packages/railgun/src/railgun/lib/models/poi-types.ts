import { Proof } from "./prover-types";

export enum TXOPOIListStatus {
  Valid = "Valid",
  ShieldBlocked = "ShieldBlocked",
  ProofSubmitted = "ProofSubmitted",
  Missing = "Missing",
}

// !! DO NOT MODIFY THIS TYPE !!
export type POIsPerList = {
  [key: string]: TXOPOIListStatus;
};

export enum BlindedCommitmentType {
  Shield = "Shield",
  Transact = "Transact",
  Unshield = "Unshield",
}

export type BlindedCommitmentData = {
  blindedCommitment: string;
  type: BlindedCommitmentType;
};

export type LegacyTransactProofData = {
  txidIndex: string;
  npk: string;
  value: string;
  tokenHash: string;
  blindedCommitment: string;
};

export type PreTransactionPOI = {
  snarkProof: Proof;
  txidMerkleroot: string;
  poiMerkleroots: string[];
  blindedCommitmentsOut: string[];
  railgunTxidIfHasUnshield: string;
};

export type PreTransactionPOIsPerTxidLeafPerList = Record<
  string, // listKey
  Record<
    string, // txidLeafHash
    PreTransactionPOI
  >
>;

export type POIEngineProofInputs = {
  // --- Public inputs ---
  anyRailgunTxidMerklerootAfterTransaction: string;
  poiMerkleroots: string[];
  // blindedCommitmentsOut: string[] - output of circuit

  // --- Private inputs ---

  // Railgun Transaction info
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];

  // Spender wallet info
  spendingPublicKey: [bigint, bigint];
  nullifyingKey: bigint;

  // Nullified notes data
  token: string;
  randomsIn: string[];
  valuesIn: bigint[];
  utxoPositionsIn: number[];
  utxoTreeIn: number;

  // Commitment notes data
  npksOut: bigint[];
  valuesOut: bigint[];
  utxoBatchGlobalStartPositionOut: bigint;

  // Unshield data
  railgunTxidIfHasUnshield: string;

  // Railgun txidIndex: string; tree
  railgunTxidMerkleProofIndices: string;
  railgunTxidMerkleProofPathElements: string[];

  // POI tree
  poiInMerkleProofIndices: string[];
  poiInMerkleProofPathElements: string[][];
};

export enum TXIDVersion {
  V2_PoseidonMerkle = "V2_PoseidonMerkle",
  V3_PoseidonMerkle = "V3_PoseidonMerkle",
  // V3_KZG = 'V3_KZG',
}

export const ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS: TXIDVersion[] = [
  TXIDVersion.V2_PoseidonMerkle,
  TXIDVersion.V3_PoseidonMerkle,
];

export const ACTIVE_TXID_VERSIONS: TXIDVersion[] = [
  TXIDVersion.V2_PoseidonMerkle,
  TXIDVersion.V3_PoseidonMerkle,
];
