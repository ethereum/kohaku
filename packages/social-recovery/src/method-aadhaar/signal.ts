import { keccak256 } from 'viem';
import { METHOD_AADHAAR_DIGEST_ERROR, METHOD_AADHAAR_DIGEST_PATTERN, METHOD_AADHAAR_SIGNAL_HASH_SHIFT } from '../constants/method-aadhaar';
import type { Hex } from '../interfaces';

/** Whether a value is a 32-byte word as 0x-prefixed hex. */
export function isDigest(value: unknown): value is Hex {
  return typeof value === 'string' && METHOD_AADHAAR_DIGEST_PATTERN.test(value);
}

function requireDigest(digest: Hex): void {
  if (!isDigest(digest)) throw new TypeError(METHOD_AADHAAR_DIGEST_ERROR);
}

/** The digest as the circuit's signal, the decimal string `generateArgs` takes. */
export function signalFromDigest(digest: Hex): string {
  requireDigest(digest);

  return BigInt(digest).toString();
}

/** The signal hash a proof's public inputs must carry for this digest. */
export function signalHashFromDigest(digest: Hex): bigint {
  requireDigest(digest);

  return BigInt(keccak256(digest)) >> METHOD_AADHAAR_SIGNAL_HASH_SHIFT;
}
