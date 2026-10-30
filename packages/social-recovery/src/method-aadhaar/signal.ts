import { keccak256 } from 'viem';
import { FORMATS_HEX_BYTES32_PATTERN } from '../constants/formats';
import { METHOD_AADHAAR_DIGEST_NAME, METHOD_AADHAAR_SIGNAL_HASH_SHIFT } from '../constants/method-aadhaar';
import { assertBytes32 } from '../formats/guards';
import type { Hex } from '../interfaces';

/** Whether a value is a 32-byte word as 0x-prefixed hex. */
export const isDigest = (value: unknown): value is Hex => typeof value === 'string' && FORMATS_HEX_BYTES32_PATTERN.test(value);

/** The digest as the circuit's signal, the decimal string `generateArgs` takes. */
export function signalFromDigest(digest: Hex): string {
  assertBytes32(digest, METHOD_AADHAAR_DIGEST_NAME);

  return BigInt(digest).toString();
}

/** The signal hash a proof's public inputs must carry for this digest. */
export function signalHashFromDigest(digest: Hex): bigint {
  assertBytes32(digest, METHOD_AADHAAR_DIGEST_NAME);

  return BigInt(keccak256(digest)) >> METHOD_AADHAAR_SIGNAL_HASH_SHIFT;
}
