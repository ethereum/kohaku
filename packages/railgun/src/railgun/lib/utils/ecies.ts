import { EncryptedData } from '../models/formatted-types';
import { toUTF8String, fromUTF8String, ByteUtils } from './bytes';
import { encryptedDataToCiphertext, ciphertextToEncryptedJSONData } from './encryption/ciphertext';
import { AES } from './encryption/aes';

export const tryDecryptJSONDataWithSharedKey = (
  encryptedData: EncryptedData,
  sharedKey: Uint8Array,
): object | null => {
  try {
    const ciphertext = encryptedDataToCiphertext(encryptedData);
    const chunkedData = AES.decryptGCM(ciphertext, sharedKey);
    const dataString = toUTF8String(ByteUtils.combine(chunkedData));

    return JSON.parse(dataString);
  } catch (err) {
    console.error(err);

    // Data is not addressed to this user.
    return null;
  }
};

export const encryptJSONDataWithSharedKey = (
  data: object,
  sharedKey: Uint8Array,
): EncryptedData => {
  const dataString = JSON.stringify(data);
  const chunkedData = ByteUtils.chunk(fromUTF8String(dataString));
  const ciphertext = AES.encryptGCM(chunkedData, sharedKey);

  return ciphertextToEncryptedJSONData(ciphertext);
};
