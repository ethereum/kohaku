import { Chain } from "../models/engine-types";
import { MerkleProof } from "../models/formatted-types";
import {
  BlindedCommitmentData,
  LegacyTransactProofData,
  POIsPerList,
  TXIDVersion,
} from "../models/poi-types";
import { Proof } from "../models/prover-types";

export abstract class POINodeInterface {
  abstract isActive(chain: Chain): boolean;

  abstract isRequired(chain: Chain): Promise<boolean>;

  abstract getPOIsPerList(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    blindedCommitmentDatas: BlindedCommitmentData[]
  ): Promise<{ [blindedCommitment: string]: POIsPerList }>;

  abstract getPOIMerkleProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    blindedCommitments: string[]
  ): Promise<MerkleProof[]>;

  abstract validatePOIMerkleroots(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    poiMerkleroots: string[]
  ): Promise<boolean>;

  abstract submitPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    snarkProof: Proof,
    poiMerkleroots: string[],
    txidMerkleroot: string,
    txidMerklerootIndex: number,
    blindedCommitmentsOut: string[],
    railgunTxidIfHasUnshield: string
  ): Promise<void>;

  abstract submitLegacyTransactProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    legacyTransactProofDatas: LegacyTransactProofData[]
  ): Promise<void>;
}
