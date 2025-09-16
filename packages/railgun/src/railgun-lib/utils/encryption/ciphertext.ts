import { Ciphertext, EncryptedData } from '../../models/formatted-types';
import { ByteLength, ByteUtils } from '../bytes';

export const ciphertextToEncryptedRandomData = (ciphertext: Ciphertext): EncryptedData => {
  const ivTag =
    ByteUtils.formatToByteLength(ciphertext.iv, ByteLength.UINT_128, true) +
    ByteUtils.formatToByteLength(ciphertext.tag, ByteLength.UINT_128, false);
  const data = ByteUtils.formatToByteLength(ciphertext.data[0], ByteLength.UINT_128, true);
  return [ivTag, data];
};

export const ciphertextToEncryptedJSONData = (ciphertext: Ciphertext): EncryptedData => {
  const ivTag =
    ByteUtils.formatToByteLength(ciphertext.iv, ByteLength.UINT_128, true) +
    ByteUtils.formatToByteLength(ciphertext.tag, ByteLength.UINT_128, false);
  const data = ByteUtils.combine(ciphertext.data);
  return [ivTag, `0x${data}`];
};

export const encryptedDataToCiphertext = (encryptedData: EncryptedData): Ciphertext => {
  const hexlifiedIvTag = ByteUtils.formatToByteLength(encryptedData[0], ByteLength.UINT_256, false);
  const ciphertext = {
    iv: hexlifiedIvTag.substring(0, 32),
    tag: hexlifiedIvTag.substring(32),
    data: ByteUtils.chunk(encryptedData[1], ByteLength.UINT_256),
  };
  return ciphertext;
};
