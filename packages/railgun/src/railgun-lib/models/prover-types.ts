import { PoseidonMerkleVerifier } from '../abi/typechain';
import { BoundParamsStruct } from '../abi/typechain/RailgunSmartWallet';
 
import { TXIDVersion } from './poi-types';

export const enum Circuits {
  OneTwo,
  OneThree,
  TwoTwo,
  TwoThree,
  EightTwo,
}

export type G1Point = {
  x: bigint;
  y: bigint;
};
export type G2Point = {
  x: [bigint, bigint];
  y: [bigint, bigint];
};

export type SnarkProof = {
  a: G1Point;
  b: G2Point;
  c: G1Point;
};

export type Proof = {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
};

export type PublicInputsRailgun = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
};

export type PrivateInputsRailgun = {
  tokenAddress: bigint;
  publicKey: [bigint, bigint];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[][];
  leavesIndices: bigint[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
};

export type RailgunTransactionRequestV2 = {
  txidVersion: TXIDVersion.V2_PoseidonMerkle;
  privateInputs: PrivateInputsRailgun;
  publicInputs: PublicInputsRailgun;
  boundParams: BoundParamsStruct;
};

export type RailgunTransactionRequestV3 = {
  txidVersion: TXIDVersion.V3_PoseidonMerkle;
  privateInputs: PrivateInputsRailgun;
  publicInputs: PublicInputsRailgun;
  boundParams: PoseidonMerkleVerifier.BoundParamsStruct;
};

export type RailgunTransactionRequest = RailgunTransactionRequestV2 | RailgunTransactionRequestV3;

export type UnprovedTransactionInputs = RailgunTransactionRequest & {
  signature: [bigint, bigint, bigint];
};

export type FormattedCircuitInputsRailgun = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
  token: bigint;
  publicKey: bigint[];
  signature: bigint[];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[];
  leavesIndices: bigint[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
};

export type NativeProverFormattedJsonInputsRailgun = {
  merkleRoot: string;
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];
  token: string;
  publicKey: string[];
  signature: string[];
  randomIn: string[];
  valueIn: string[];
  pathElements: string[];
  leavesIndices: string[];
  nullifyingKey: string;
  npkOut: string[];
  valueOut: string[];
};

export type PublicInputsPOI = {
  anyRailgunTxidMerklerootAfterTransaction: bigint;
  blindedCommitmentsOut: bigint[];
  poiMerkleroots: bigint[];
  railgunTxidIfHasUnshield: bigint;
};

export type FormattedCircuitInputsPOI = {
  // Public inputs
  anyRailgunTxidMerklerootAfterTransaction: bigint;
  poiMerkleroots: bigint[];

  // Private inputs
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
  spendingPublicKey: [bigint, bigint];
  nullifyingKey: bigint;
  token: bigint;
  randomsIn: bigint[];
  valuesIn: bigint[];
  utxoPositionsIn: bigint[];
  utxoTreeIn: bigint;
  npksOut: bigint[];
  valuesOut: bigint[];
  utxoBatchGlobalStartPositionOut: bigint;
  railgunTxidIfHasUnshield: bigint;
  railgunTxidMerkleProofIndices: bigint;
  railgunTxidMerkleProofPathElements: bigint[];
  poiInMerkleProofIndices: bigint[];
  poiInMerkleProofPathElements: bigint[][];
};

export type NativeProverFormattedJsonInputsPOI = {
  // Public inputs
  anyRailgunTxidMerklerootAfterTransaction: string;
  poiMerkleroots: string[];

  // Private inputs
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];
  spendingPublicKey: [string, string];
  nullifyingKey: string;
  token: string;
  randomsIn: string[];
  valuesIn: string[];
  utxoPositionsIn: string[];
  utxoTreeIn: string;
  npksOut: string[];
  valuesOut: string[];
  utxoBatchGlobalStartPositionOut: string;
  railgunTxidIfHasUnshield: string;
  railgunTxidMerkleProofIndices: string;
  railgunTxidMerkleProofPathElements: string[];
  poiInMerkleProofIndices: string[];
  poiInMerkleProofPathElements: string[][];
};

export type ArtifactGetter = {
  assertArtifactExists: (nullifiers: number, commitments: number) => void;
  getArtifacts: (publicInputs: PublicInputsRailgun) => Promise<Artifact>;
  getArtifactsPOI: (maxInputs: number, maxOutputs: number) => Promise<Artifact>;
};
