import { CommitmentPreimageStruct } from '../abi/typechain/RailgunSmartWallet';
import { UnshieldData } from '../models';
import { TokenData } from '../models/formatted-types';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { assertValidNoteToken, getNoteHash, serializePreImage } from './note-util';

export abstract class UnshieldNote {
  readonly toAddress: string;

  readonly value: bigint;

  readonly tokenData: TokenData;

  readonly hash: bigint;

  readonly allowOverride: boolean;

  /**
   * Create Note object
   *
   * @param toAddress - address to unshield to
   * @param value - note value
   * @param tokenData
   */
  constructor(toAddress: string, value: bigint, tokenData: TokenData, allowOverride: boolean) {
    assertValidNoteToken(tokenData, value);

    this.toAddress = toAddress;
    this.value = value;
    this.tokenData = tokenData;
    this.allowOverride = allowOverride;
    this.hash = getNoteHash(toAddress, tokenData, value);
  }

  get unshieldData(): UnshieldData {
    return {
      toAddress: this.toAddress,
      value: this.value,
      tokenData: this.tokenData,
      allowOverride: this.allowOverride,
    };
  }

  get npk(): string {
    return this.toAddress;
  }

  get notePublicKey() {
    return BigInt(this.npk);
  }

  get hashHex(): string {
    return ByteUtils.nToHex(this.hash, ByteLength.UINT_256);
  }

  serialize(prefix: boolean = false) {
    return serializePreImage(this.toAddress, this.tokenData, this.value, prefix);
  }

  get preImage(): CommitmentPreimageStruct {
    const { npk, tokenData, value } = this;
    return { npk, token: tokenData, value };
  }

  static getAmountFeeFromValue(
    value: bigint,
    feeBasisPoints: bigint,
  ): { amount: bigint; fee: bigint } {
    const BASIS_POINTS = 10000n;
    const fee = (value * feeBasisPoints) / BASIS_POINTS;
    const amount = value - fee;
    return { amount, fee };
  }
}
