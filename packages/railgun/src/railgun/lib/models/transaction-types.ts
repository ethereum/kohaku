import { BytesLike } from "ethers";
import { PoseidonMerkleVerifier } from "../abi/typechain";
import { CommitmentPreimageStruct } from "../abi/typechain/PoseidonMerkleAccumulator";
import {
  SnarkProofStruct,
  BoundParamsStruct,
} from "../abi/typechain/RailgunSmartWallet";
import { TXIDVersion } from "./poi-types";

export type TransactionStructV2 = {
  txidVersion: TXIDVersion.V2_PoseidonMerkle;
  proof: SnarkProofStruct;
  merkleRoot: BytesLike;
  nullifiers: BytesLike[];
  commitments: BytesLike[];
  boundParams: BoundParamsStruct;
  unshieldPreimage: CommitmentPreimageStruct;
};

export type TransactionStructV3 = {
  txidVersion: TXIDVersion.V3_PoseidonMerkle;
  proof: SnarkProofStruct;
  merkleRoot: BytesLike;
  nullifiers: BytesLike[];
  commitments: BytesLike[];
  boundParams: PoseidonMerkleVerifier.BoundParamsStruct;
  unshieldPreimage: CommitmentPreimageStruct;
};

export type ExtractedRailgunTransactionData = {
  railgunTxid: string;
  utxoTreeIn: bigint;
  firstCommitment: Optional<string>;
  firstCommitmentNotePublicKey: Optional<bigint>;
}[];
