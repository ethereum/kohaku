import {
  FORMATS_HEX_BYTES32_PATTERN,
  METHOD_ZKPASSPORT_TRUSTED_KEY_COUNT,
  METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE,
  METHOD_ZKPASSPORT_VERSION_KEY,
} from '../constants';
import { zkPassportVersionOf } from '../description/zkpassport-version';
import { lowerHex } from '../formats/guards';
import type { Hex } from '../interfaces';
import type { ZkPassportSession } from '../types';

const isVersionWord = (word: Hex): boolean => {
  try {
    zkPassportVersionOf(word);
  } catch {
    return false;
  }

  return true;
};

/** The words lower-cased, or undefined unless the value holds exactly the module's count of 32-byte words, the first one `zkPassportVersionOf` reads. */
const trustedKeysOf = (value: unknown): readonly Hex[] | undefined => {
  if (!Array.isArray(value) || value.length !== METHOD_ZKPASSPORT_TRUSTED_KEY_COUNT) return undefined;

  const keys: Hex[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const key: unknown = value[index];

    if (!Object.hasOwn(value, index) || typeof key !== 'string' || !FORMATS_HEX_BYTES32_PATTERN.test(key)) return undefined;

    keys.push(lowerHex(key as Hex));
  }

  const version = keys[METHOD_ZKPASSPORT_VERSION_KEY];

  return version !== undefined && isVersionWord(version) ? keys : undefined;
};

/** The session member the parameters' `trustedKeys` give: none where absent; `TypeError` where they are not the module's words. */
export const paramsTrustedKeys = (value: unknown): Pick<ZkPassportSession, 'trustedKeys'> => {
  if (value === undefined) return {};

  const keys = trustedKeysOf(value);

  if (keys === undefined) throw new TypeError(METHOD_ZKPASSPORT_TRUSTED_KEYS_MESSAGE);

  return { trustedKeys: keys };
};

/** The session member an input record's `trustedKeys` give: none where absent, undefined where they are not the module's words. */
export const inputTrustedKeys = (value: unknown): Pick<ZkPassportSession, 'trustedKeys'> | undefined => {
  if (value === undefined) return {};

  const keys = trustedKeysOf(value);

  return keys === undefined ? undefined : { trustedKeys: keys };
};

/** Whether the session accepts the proof's version word: always without `trustedKeys`, else by value against their version word; throws on a version that is not an integer. */
export const versionTrusted = (session: ZkPassportSession, version: string): boolean => {
  const accepted = session.trustedKeys?.[METHOD_ZKPASSPORT_VERSION_KEY];

  return accepted === undefined || BigInt(version) === BigInt(accepted);
};
