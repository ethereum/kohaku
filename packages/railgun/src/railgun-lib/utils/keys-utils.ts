import { utils as utilsEd25519, Point, getPublicKey, sign, verify, CURVE } from '@noble/ed25519';
import { eddsa, Signature } from '@railgun-community/circomlibjs';
import { poseidonHex } from './poseidon';
import { ByteUtils } from './bytes';
import { sha256, sha512 } from './hash';
import { scalarMultiplyWasmFallbackToJavascript } from './scalar-multiply';

const { bytesToHex, randomBytes } = utilsEd25519;

function getPublicSpendingKey(privateKey: Uint8Array): [bigint, bigint] {
  if (privateKey.length !== 32) throw Error('Invalid private key length');
  return eddsa.prv2pub(Buffer.from(privateKey));
}

async function getPublicViewingKey(privateViewingKey: Uint8Array): Promise<Uint8Array> {
  return getPublicKey(privateViewingKey);
}

function getRandomScalar(): bigint {
  return ByteUtils.hexToBigInt(poseidonHex([ByteUtils.fastBytesToHex(randomBytes(32))]));
}

function signEDDSA(privateKey: Uint8Array, message: bigint): Signature {
  return eddsa.signPoseidon(Buffer.from(privateKey), message);
}

function verifyEDDSA(message: bigint, signature: Signature, pubkey: [bigint, bigint]) {
  return eddsa.verifyPoseidon(message, signature, pubkey);
}

async function signED25519(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return sign(message, privateKey);
}

function verifyED25519(
  message: string | Uint8Array,
  signature: string | Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  return verify(signature, message, pubkey);
}

/**
 * Adjust bits to match the pattern xxxxx000...01xxxxxx for little endian and 01xxxxxx...xxxxx000 for big endian
 * This ensures that the bytes are a little endian representation of an integer of the form (2^254 + 8) * x where
 * 0 \< x \<= 2^251 - 1, which can be decoded as an X25519 integer.
 *
 * @param bytes - bytes to adjust
 * @param endian - what endian to use
 * @returns adjusted bytes
 */
function adjustBytes25519(bytes: Uint8Array, endian: 'be' | 'le'): Uint8Array {
  // Create new array to prevent side effects
  const adjustedBytes = new Uint8Array(bytes);

  if (endian === 'be') {
    // BIG ENDIAN
    // AND operation to ensure the last 3 bits of the last byte are 0 leaving the rest unchanged
    adjustedBytes[31] &= 0b11111000;

    // AND operation to ensure the first bit of the first byte is 0 leaving the rest unchanged
    adjustedBytes[0] &= 0b01111111;

    // OR operation to ensure the second bit of the first byte is 0 leaving the rest unchanged
    adjustedBytes[0] |= 0b01000000;
  } else {
    // LITTLE ENDIAN
    // AND operation to ensure the last 3 bits of the first byte are 0 leaving the rest unchanged
    adjustedBytes[0] &= 0b11111000;

    // AND operation to ensure the first bit of the last byte is 0 leaving the rest unchanged
    adjustedBytes[31] &= 0b01111111;

    // OR operation to ensure the second bit of the last byte is 0 leaving the rest unchanged
    adjustedBytes[31] |= 0b01000000;
  }

  // Return adjusted bytes
  return adjustedBytes;
}

async function getPrivateScalarFromPrivateKey(privateKey: Uint8Array): Promise<bigint> {
  // Private key should be 32 bytes
  if (privateKey.length !== 32) throw new Error('Expected 32 bytes');

  // SHA512 hash private key
  const hash = await utilsEd25519.sha512(privateKey);

  // Get key head, this is the first 32 bytes of the hash
  // We aren't interested in the rest of the hash as we only want the scalar
  const head = adjustBytes25519(hash.slice(0, 32), 'le');

  // Convert head to scalar
  const scalar = BigInt(`0x${utilsEd25519.bytesToHex(head.reverse())}`) % CURVE.l;

  return scalar > 0n ? scalar : CURVE.l;
}

/**
 * Converts seed to curve scalar
 *
 * @param seed - seed to convert
 * @returns scalar
 */
function seedToScalar(seed: Uint8Array): Uint8Array {
  // Hash to 512 bit value as per FIPS-186
  const seedHash = sha512(seed);

  // Return (seedHash mod (n - 1)) + 1 to fit to range 0 < scalar < n
  return ByteUtils.nToBytes((ByteUtils.hexToBigInt(seedHash) % CURVE.n) - 1n + 1n, 32);
}

/**
 * Generate blinding scalar value.
 * Combine sender and shared random via XOR
 * XOR is used because a 0 value senderRandom result in a no change to the sharedRandom
 * allowing the receiver to invert the blinding operation
 * Final random value is padded to 32 bytes
 * Get blinding scalar from random
 *
 * @param sharedRandom - random value shared by both parties
 * @param senderRandom - random value only known to sender
 * @returns ephemeral keys
 */

function getBlindingScalar(sharedRandom: string, senderRandom: string): bigint {
  const finalRandom = ByteUtils.nToBytes(
    ByteUtils.hexToBigInt(sharedRandom) ^ ByteUtils.hexToBigInt(senderRandom),
    32,
  );
  return ByteUtils.bytesToN(seedToScalar(finalRandom));
}

/**
 * Blinds sender and receiver public keys
 *
 * @param senderViewingPublicKey - Sender's viewing public key
 * @param receiverViewingPublicKey - Receiver's viewing public key
 * @param sharedRandom - random value shared by both parties
 * @param senderRandom - random value only known to sender
 * @returns ephemeral keys
 */
function getNoteBlindingKeys(
  senderViewingPublicKey: Uint8Array,
  receiverViewingPublicKey: Uint8Array,
  sharedRandom: string,
  senderRandom: string,
): { blindedSenderViewingKey: Uint8Array; blindedReceiverViewingKey: Uint8Array } {
  const blindingScalar = getBlindingScalar(sharedRandom, senderRandom);

  // Get public key points
  const senderPublicKeyPoint = Point.fromHex(senderViewingPublicKey);
  const receiverPublicKeyPoint = Point.fromHex(receiverViewingPublicKey);

  // Multiply both public keys by blinding scalar
  const blindedSenderViewingKey = senderPublicKeyPoint.multiply(blindingScalar).toRawBytes();
  const blindedReceiverViewingKey = receiverPublicKeyPoint.multiply(blindingScalar).toRawBytes();

  // Return blinded keys
  return { blindedSenderViewingKey, blindedReceiverViewingKey };
}

function unblindNoteKey(
  blindedNoteKey: Uint8Array,
  sharedRandom: string,
  senderRandom: string,
): Optional<Uint8Array> {
  try {
    const blindingScalar = getBlindingScalar(sharedRandom, senderRandom);

    // Create curve point instance from ephemeral key bytes
    const point = Point.fromHex(bytesToHex(blindedNoteKey));

    // Invert the scalar to undo blinding multiplication operation
    const inverse = utilsEd25519.invert(blindingScalar, CURVE.n);

    // Unblind by multiplying by the inverted scalar
    const unblinded = point.multiply(inverse);

    return unblinded.toRawBytes();
  } catch {
    return undefined;
  }
}

async function getSharedSymmetricKey(
  privateKeyPairA: Uint8Array,
  blindedPublicKeyPairB: Uint8Array,
): Promise<Optional<Uint8Array>> {
  try {
    // Retrieve private scalar from private key
    const scalar: bigint = await getPrivateScalarFromPrivateKey(privateKeyPairA);

    // Multiply ephemeral key by private scalar to get shared key
    const keyPreimage: Uint8Array = scalarMultiplyWasmFallbackToJavascript(
      blindedPublicKeyPairB,
      scalar,
    );

    // SHA256 hash to get the final key
    const hashed: Uint8Array = ByteUtils.hexStringToBytes(sha256(keyPreimage));
    return hashed;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

function generateNaiveRandomHex(length = 16): string {
  const CHARSET = 'abcdefghijklnopqrstuvwxyz0123456789';
  let retVal = '';
  for (let i = 0; i < length; i += 1) {
    retVal += CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
  }
  return retVal;
}

export {
  getPublicSpendingKey,
  getPublicViewingKey,
  getRandomScalar,
  signEDDSA,
  verifyEDDSA,
  signED25519,
  verifyED25519,
  getSharedSymmetricKey,
  getPrivateScalarFromPrivateKey,
  adjustBytes25519,
  getNoteBlindingKeys,
  unblindNoteKey,
  generateNaiveRandomHex,
};
