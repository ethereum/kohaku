import crypto from 'crypto';
import { ByteUtils } from './bytes';
import EMOJIS from './emojis.json';

export const emojiHash = (str: string, length?: number): string => {
  return hashEmoji(str, length);
};

export const emojiHashForPOIStatusInfo = (str: string): string => {
  return emojiHash(ByteUtils.strip0x(str), 2);
};

const hashEmoji = (string: string, hashLength = 1) => {
  const hash = crypto.createHash('sha256');

  hash.update(`${string}`);

  const hexHash = hash.digest('hex');
  const decimalHash = parseInt(hexHash, 16);
  let emojiIndex = decimalHash % EMOJIS.length ** hashLength;

  let emojiString = '';

  for (let ii = 0; ii < hashLength; ii += 1) {
    emojiString = `${EMOJIS[emojiIndex % EMOJIS.length]}${emojiString}`;
    emojiIndex = Math.floor(emojiIndex / EMOJIS.length);
  }

  return emojiString;
};
