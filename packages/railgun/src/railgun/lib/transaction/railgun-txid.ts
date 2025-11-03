import { poseidon } from '../utils/poseidon';
import { RailgunTransaction, RailgunTransactionWithHash } from '../models/formatted-types';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { MERKLE_ZERO_VALUE_BIGINT } from '../models/merkletree-types';
import { getGlobalTreePosition } from '../poi/global-tree-position';
import { keccak256 } from '../utils/hash';

const padWithZerosToMax = (array: bigint[], max: number): bigint[] => {
  const padded = [...array];

  while (padded.length < max) {
    padded.push(MERKLE_ZERO_VALUE_BIGINT);
  }

  return padded;
};

export const getRailgunTransactionID = (railgunTransaction: {
  nullifiers: string[];
  commitments: string[];
  boundParamsHash: string;
}): bigint => {
  const nullifierBigInts = railgunTransaction.nullifiers.map((el) => ByteUtils.hexToBigInt(el));
  const commitmentBigInts = railgunTransaction.commitments.map((el) => ByteUtils.hexToBigInt(el));
  const boundParamsHashBigInt = ByteUtils.hexToBigInt(railgunTransaction.boundParamsHash);

  return getRailgunTransactionIDFromBigInts(
    nullifierBigInts,
    commitmentBigInts,
    boundParamsHashBigInt,
  );
};

export const getRailgunTransactionIDFromBigInts = (
  nullifiers: bigint[],
  commitments: bigint[],
  boundParamsHash: bigint,
): bigint => {
  const maxInputs = 13; // Always 13 - no matter the POI circuit
  const nullifiersPadded = padWithZerosToMax(nullifiers, maxInputs);
  const nullifiersHash = poseidon(nullifiersPadded);

  const maxOutputs = 13; // Always 13 - no matter the POI circuit
  const commitmentsPadded = padWithZerosToMax(commitments, maxOutputs);
  const commitmentsHash = poseidon(commitmentsPadded);

  return poseidon([nullifiersHash, commitmentsHash, boundParamsHash]);
};

export const getRailgunTransactionIDHex = (railgunTransaction: {
  nullifiers: string[];
  commitments: string[];
  boundParamsHash: string;
}): string => {
  const railgunTxid = getRailgunTransactionID(railgunTransaction);

  return ByteUtils.nToHex(railgunTxid, ByteLength.UINT_256);
};

export const getRailgunTxidLeafHash = (
  railgunTxidBigInt: bigint,
  utxoTreeIn: bigint,
  globalTreePosition: bigint,
): string => {
  return ByteUtils.nToHex(
    poseidon([railgunTxidBigInt, utxoTreeIn, globalTreePosition]),
    ByteLength.UINT_256,
  );
};

export const createRailgunTransactionWithHash = (
  railgunTransaction: RailgunTransaction,
): RailgunTransactionWithHash => {
  const railgunTxidBigInt = getRailgunTransactionID(railgunTransaction);
  const { utxoTreeIn, utxoTreeOut, utxoBatchStartPositionOut } = railgunTransaction;
  const globalTreePosition = getGlobalTreePosition(utxoTreeOut, utxoBatchStartPositionOut);

  return {
    ...railgunTransaction,
    railgunTxid: ByteUtils.nToHex(railgunTxidBigInt, ByteLength.UINT_256),
    hash: getRailgunTxidLeafHash(railgunTxidBigInt, BigInt(utxoTreeIn), globalTreePosition),
  };
};

export const calculateRailgunTransactionVerificationHash = (
  previousVerificationHash: Optional<string>,
  firstNullifier: string,
): string => {
  // hash[n] = keccak(hash[n-1] ?? 0, n_firstNullifier);

  const combinedData: string = ByteUtils.combine([
    ByteUtils.hexToBytes(previousVerificationHash ?? '0x'),
    ByteUtils.hexToBytes(firstNullifier),
  ]);

  return ByteUtils.formatToByteLength(keccak256(combinedData), ByteLength.UINT_256, true);
};
