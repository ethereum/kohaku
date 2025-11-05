import { poseidon } from "../utils/poseidon";
import { ByteLength, ByteUtils } from "../utils/bytes";

const formatHash = (hash: bigint): string => {
  return `0x${ByteUtils.nToHex(hash, ByteLength.UINT_256)}`;
};

export class BlindedCommitment {
  static getForUnshield(railgunTxid: string) {
    return ByteUtils.formatToByteLength(railgunTxid, ByteLength.UINT_256, true);
  }

  static getForShieldOrTransact(
    commitmentHash: string,
    npk: bigint,
    globalTreePosition: bigint
  ) {
    const hash: bigint = poseidon([
      ByteUtils.hexToBigInt(commitmentHash),
      npk,
      globalTreePosition,
    ]);

    return formatHash(hash);
  }
}
