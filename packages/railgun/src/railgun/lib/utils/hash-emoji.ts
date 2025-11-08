import { ByteUtils } from './bytes';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from 'ethereum-cryptography/utils';
import EMOJIS from './emojis.json';

export const emojiHash = (str: string, length?: number): string => {
  return hashEmoji(str, length);
};

export const emojiHashForPOIStatusInfo = (str: string): string => {
  return emojiHash(ByteUtils.strip0x(str), 2);
};

const hashEmoji = (string: string, hashLength = 1) => {
  const hashBytes = sha256(`${string}`);
  const hexHash = bytesToHex(hashBytes);
  const decimalHash = parseInt(hexHash, 16);
  let emojiIndex = decimalHash % EMOJIS.length ** hashLength;

  let emojiString = '';

  for (let ii = 0; ii < hashLength; ii += 1) {
    emojiString = `${EMOJIS[emojiIndex % EMOJIS.length]}${emojiString}`;
    emojiIndex = Math.floor(emojiIndex / EMOJIS.length);
  }

  return emojiString;
};
