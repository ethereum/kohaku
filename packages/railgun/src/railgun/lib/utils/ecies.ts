import { EncryptedData } from '../models/formatted-types';
import { toUTF8String, fromUTF8String, ByteUtils } from './bytes';
import { encryptedDataToCiphertext, ciphertextToEncryptedJSONData } from './encryption/ciphertext';
import { AES } from './encryption/aes';

export const tryDecryptJSONDataWithSharedKey = async (
  encryptedData: EncryptedData,
  sharedKey: Uint8Array,
): Promise<object | null> => {
  try {
    const ciphertext = encryptedDataToCiphertext(encryptedData);
    const chunkedData = await AES.decryptGCM(ciphertext, sharedKey);
    const dataString = toUTF8String(ByteUtils.combine(chunkedData));

    return JSON.parse(dataString);
  } catch (err) {
    console.error(err);

    // Data is not addressed to this user.
    return null;
  }
};

export const encryptJSONDataWithSharedKey = async (
  data: object,
  sharedKey: Uint8Array,
): Promise<EncryptedData> => {
  const dataString = JSON.stringify(data);
  const chunkedData = ByteUtils.chunk(fromUTF8String(dataString));
  const ciphertext = await AES.encryptGCM(chunkedData, sharedKey);

  return ciphertextToEncryptedJSONData(ciphertext);
};
