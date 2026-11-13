import { FORMATS_HEX_BYTES32_PATTERN } from '../constants/formats';
import { METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE, METHOD_AADHAAR_TRUSTED_KEYS_PARAM } from '../constants/method-aadhaar-params';
import type { Params } from '../interfaces';

/**
 * The method module's one trusted key from the params' `trustedKeys`, as `trustedParties` read them, or `undefined` where the
 * params name none; a `TypeError` for anything but an array of exactly one 32-byte hex word.
 */
export function readTrustedKey(params: Params | undefined): bigint | undefined {
  const keys = params?.[METHOD_AADHAAR_TRUSTED_KEYS_PARAM];

  if (keys === undefined) return undefined;

  const [word] = Array.isArray(keys) && keys.length === 1 ? keys : [];

  if (typeof word !== 'string' || !FORMATS_HEX_BYTES32_PATTERN.test(word)) {
    throw new TypeError(`${METHOD_AADHAAR_TRUSTED_KEYS_PARAM} ${METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE}`);
  }

  return BigInt(word);
}
