import { KeyNode } from '../models/engine-types';
import { fromUTF8String, ByteUtils } from '../utils/bytes';
import { sha512HMAC } from '../utils/hash';

const CURVE_SEED = fromUTF8String('babyjubjub seed');

/**
 * Tests derivation path to see if it's valid
 * @param path - bath to test
 * @returns valid
 */
function isValidPath(path: string): boolean {
  return /^m(\/[0-9]+')+$/g.test(path);
}

/**
 * Converts path string into segments
 * @param path - path string to parse
 * @returns array of indexes
 */
export function getPathSegments(path: string): number[] {
  // Throw if path is invalid
  if (!isValidPath(path)) throw new Error('Invalid derivation path');

  // Split along '/' to get each component
  // Remove the first segment as it is the 'm'
  // Remove the ' from each segment
  // Parse each segment into an integer
  return path
    .split('/')
    .slice(1)
    .map((val) => val.replace("'", ''))
    .map((el) => parseInt(el, 10));
}

/**
 * Derive child KeyNode from KeyNode via hardened derivation
 * @param node - KeyNode to derive from
 * @param index - index of child
 */
export function childKeyDerivationHardened(
  node: KeyNode,
  index: number,
  offset: number = 0x80000000,
): KeyNode {
  // Convert index to bytes as 32bit big endian
  const indexFormatted = ByteUtils.padToLength(index + offset, 4);

  // Calculate HMAC preImage
  const preImage = `00${node.chainKey}${indexFormatted as string}`;

  // Calculate I
  const I = sha512HMAC(node.chainCode, preImage);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return {
    chainKey,
    chainCode,
  };
}

/**
 * Creates KeyNode from seed
 * @param seed - bip32 seed
 * @returns BjjNode - babyjubjub BIP32Node
 */
export function getMasterKeyFromSeed(seed: string): KeyNode {
  // HMAC with seed to get I
  const I = sha512HMAC(CURVE_SEED, seed);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return {
    chainKey,
    chainCode,
  };
}
