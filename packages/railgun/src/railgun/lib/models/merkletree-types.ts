import { ByteLength, fromUTF8String, ByteUtils } from '../utils/bytes';
import { SNARK_PRIME } from '../utils/constants';
import { keccak256 } from '../utils/hash';
import { Chain } from './engine-types';
import { TXIDVersion } from './poi-types';

export const TREE_DEPTH = 16;
export const TREE_MAX_ITEMS = 65_536; // 2^16

export type MerklerootValidator = (
  txidVersion: TXIDVersion,
  chain: Chain,
  tree: number,
  index: number,
  merkleroot: string,
) => Promise<boolean>;

export type MerkletreeLeaf = {
  hash: string;
};

export type InvalidMerklerootDetails = {
  position: number;
  blockNumber: number;
};

// Optimization: process leaves for a many commitment groups before checking merkleroot against contract.
// If merkleroot is invalid, scan leaves as medium batches, and individually as a final backup.
// For Txid merkletree on POI Nodes, re-calculate for every Single tree update, in order to capture its merkleroot.
export enum CommitmentProcessingGroupSize {
  XXXLarge = 8000,
  XXLarge = 1600,
  XLarge = 800,
  Large = 200,
  Medium = 40,
  Small = 10,
  Single = 1,
}

type TreeMetadata = {
  scannedHeight: number;
  invalidMerklerootDetails: InvalidMerklerootDetails | null;
};
export type MerkletreesMetadata = {
  trees: { [tree: number]: TreeMetadata };
};

// Calculate tree zero value
export const MERKLE_ZERO_VALUE_BIGINT: bigint =
  ByteUtils.hexToBigInt(keccak256(fromUTF8String('Railgun'))) % SNARK_PRIME;

export const MERKLE_ZERO_VALUE: string = ByteUtils.nToHex(
  MERKLE_ZERO_VALUE_BIGINT,
  ByteLength.UINT_256,
);
