import * as nobleED25519 from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { keccak_256, keccak_512 } from '@noble/hashes/sha3';
import { getRandomBytesSync } from 'ethereum-cryptography/random';
import { buildEddsa, buildPoseidonOpt } from 'circomlibjs';
import { arrayToBigInt, bigIntToArray, arrayToByteLength } from './bytes';

/**
 * Gets random bytes
 *
 * @param length - random bytes length
 * @returns random bytes
 */
function randomBytes(length: number) {
  return getRandomBytesSync(length);
}

const poseidonPromise = buildPoseidonOpt();

const hash = {
  /**
   * Poseidon hash
   *
   * @param inputs - inputs to hash
   * @returns hash
   */
  poseidon: async (inputs: Uint8Array[]): Promise<Uint8Array> => {
    const poseidonBuild = await poseidonPromise;

    // Convert inputs to LE montgomery representation then convert back to standard at end
    const result = poseidonBuild.F.fromMontgomery(
      poseidonBuild(
        inputs.map((input) => poseidonBuild.F.toMontgomery(new Uint8Array(input).reverse())),
      ),
    );

    return arrayToByteLength(result, 32).reverse();
  },

  /**
   * SHA256 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  sha256: (input: Uint8Array): Uint8Array => {
    return sha256(input);
  },

  /**
   * SHA512 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  sha512: (input: Uint8Array): Uint8Array => {
    return sha512(input);
  },

  /**
   * Keccak256 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  keccak256: (input: Uint8Array): Uint8Array => {
    return keccak_256(input);
  },

  /**
   * Keccak5125 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  keccak512: (input: Uint8Array): Uint8Array => {
    return keccak_512(input);
  },
};

// Simplified AES implementation using Web Crypto API principles
// For production, consider using @noble/ciphers or similar library
const aes = {
  gcm: {
    /**
     * Encrypt plaintext with AES-GCM-256
     * Note: This is a stub. Full browser support requires Web Crypto API or @noble/ciphers
     *
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @returns encrypted bundle
     */
    encrypt(plaintext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      throw new Error('AES-GCM encryption not implemented for browser. Use @noble/ciphers or Web Crypto API.');
    },

    /**
     * Decrypt encrypted bundle with AES-GCM-256
     * Note: This is a stub. Full browser support requires Web Crypto API or @noble/ciphers
     *
     * @param ciphertext - encrypted bundle to decrypt
     * @param key - key to decrypt with
     * @returns plaintext
     */
    decrypt(ciphertext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      throw new Error('AES-GCM decryption not implemented for browser. Use @noble/ciphers or Web Crypto API.');
    },
  },
  ctr: {
    /**
     * Encrypt plaintext with AES-CTR-256
     * Note: This is a stub. Full browser support requires Web Crypto API or @noble/ciphers
     *
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @returns encrypted bundle
     */
    encrypt(plaintext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      throw new Error('AES-CTR encryption not implemented for browser. Use @noble/ciphers or Web Crypto API.');
    },

    /**
     * Decrypt encrypted bundle with AES-CTR-256
     * Note: This is a stub. Full browser support requires Web Crypto API or @noble/ciphers
     *
     * @param ciphertext - encrypted bundle to decrypt
     * @param key - key to decrypt with
     * @returns plaintext
     */
    decrypt(ciphertext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      throw new Error('AES-CTR decryption not implemented for browser. Use @noble/ciphers or Web Crypto API.');
    },
  },
};

const ed25519 = {
  /**
   * Adjust bits to match the pattern xxxxx000...01xxxxxx for little endian and 01xxxxxx...xxxxx000 for big endian
   * This ensures that the bytes are a little endian representation of an integer of the form (2^254 + 8) * x where
   * 0 \< x \<= 2^251 - 1, which can be decoded as an X25519 integer.
   *
   * @param bytes - bytes to adjust
   * @param endian - what endian to use
   * @returns adjusted bytes
   */
  adjustBytes25519(bytes: Uint8Array, endian: 'be' | 'le'): Uint8Array {
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
  },

  /**
   * Gets public key for given private key
   *
   * @param privateKey - private key to get public key for
   * @returns public key
   */
  privateKeyToPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
    return nobleED25519.getPublicKey(privateKey);
  },

  /**
   * Convert private key to private scalar
   *
   * @param privateKey - private key to convert
   * @returns private scalar
   */
  privateKeyToPrivateScalar(privateKey: Uint8Array) {
    // SHA512 hash private key
    const keyHash = hash.sha512(privateKey);

    // Get key head, this is the first 32 bytes of the hash
    // We aren't interested in the rest of the hash as we only want the scalar
    const head = ed25519.adjustBytes25519(keyHash.slice(0, 32), 'le');

    // Convert head to scalar
    const scalar = arrayToBigInt(head.reverse()) % nobleED25519.CURVE.n;

    // Return scalar, or CURVE.n if scalar is 0
    return bigIntToArray(scalar > 0n ? scalar : nobleED25519.CURVE.n, 32);
  },

  /**
   * Generates shared key from private key and counter party public key
   *
   * @param privateKey - private key value
   * @param publicKey - counter party public key
   * @returns shared key
   */
  getSharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    // Get ephemeral key point representation
    const publicKeyPoint = nobleED25519.Point.fromHex(publicKey);

    // Get private scalar
    const privateScalar = ed25519.privateKeyToPrivateScalar(privateKey);

    // Multiply ephemeral key by private scalar to get shared key preimage
    const keyPreimage = publicKeyPoint.multiply(arrayToBigInt(privateScalar)).toRawBytes();

    // SHA256 hash to get the final key
    return sha256(keyPreimage);
  },

  /**
   * Converts seed to curve scalar
   *
   * @param seed - seed to convert
   * @returns scalar
   */
  seedToScalar(seed: Uint8Array): Uint8Array {
    // Hash to 512 bit value as per FIPS-186
    const seedHash = hash.sha512(seed);

    // Return (seedHash mod (n - 1)) + 1 to fit to range 0 < scalar < n
    return bigIntToArray((arrayToBigInt(seedHash) % nobleED25519.CURVE.n) - 1n + 1n, 32);
  },

  railgunKeyExchange: {
    /**
     * Blinds sender and receiver public keys
     *
     * @param senderViewingPublicKey - Sender's viewing public key
     * @param receiverViewingPublicKey - Receiver's viewing public key
     * @param sharedRandom - random value shared by both parties
     * @param senderRandom - random value only known to sender
     * @returns ephemeral keys
     */
    blindKeys(
      senderViewingPublicKey: Uint8Array,
      receiverViewingPublicKey: Uint8Array,
      sharedRandom: Uint8Array,
      senderRandom: Uint8Array,
    ): { blindedSenderPublicKey: Uint8Array; blindedReceiverPublicKey: Uint8Array } {
      // Combine sender and shared random via XOR
      // XOR is used because a 0 value senderRandom result in a no change to the sharedRandom
      // allowing the receiver to invert the blinding operation
      // Final random value is padded to 32 bytes
      const finalRandom = bigIntToArray(
        arrayToBigInt(sharedRandom) ^ arrayToBigInt(senderRandom),
        32,
      );

      // Get blinding scalar from random
      const blindingScalar = ed25519.seedToScalar(finalRandom);

      // Get public key points
      const senderPublicKeyPoint = nobleED25519.Point.fromHex(senderViewingPublicKey);
      const receiverPublicKeyPoint = nobleED25519.Point.fromHex(receiverViewingPublicKey);

      // Multiply both public keys by blinding scalar
      const blindedSenderPublicKey = senderPublicKeyPoint
        .multiply(arrayToBigInt(blindingScalar))
        .toRawBytes();
      const blindedReceiverPublicKey = receiverPublicKeyPoint
        .multiply(arrayToBigInt(blindingScalar))
        .toRawBytes();

      // Return blinded keys
      return { blindedSenderPublicKey, blindedReceiverPublicKey };
    },
  },
};

const eddsaPromise = buildEddsa();

const edBabyJubJub = {
  /**
   * Convert eddsa-babyjubjub private key to public key
   *
   * @param privateKey - babyjubjub private key
   * @returns public key
   */
  async privateKeyToPublicKey(privateKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
    const eddsaBuild = await eddsaPromise;

    // Derive key
    const key = eddsaBuild
      .prv2pub(privateKey)
      .map((element) => eddsaBuild.F.fromMontgomery(element).reverse()) as [Uint8Array, Uint8Array];

    return key;
  },

  /**
   * Generates a random babyJubJub point
   *
   * @returns random point
   */
  genRandomPoint(): Promise<Uint8Array> {
    return hash.poseidon([randomBytes(32)]);
  },

  /**
   * Creates eddsa-babyjubjub signature with poseidon hash
   *
   * @param key - private key
   * @param message - message to sign
   * @returns signature
   */
  async signPoseidon(
    key: Uint8Array,
    message: Uint8Array,
  ): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
    const eddsaBuild = await eddsaPromise;

    // Get montgomery representation
    const montgomery = eddsaBuild.F.toMontgomery(new Uint8Array(message).reverse());

    // Sign
    const sig = eddsaBuild.signPoseidon(key, montgomery);

    // Convert R8 elements from montgomery and to BE
    const r8 = sig.R8.map((element) => eddsaBuild.F.fromMontgomery(element).reverse());

    return [r8[0], r8[1], bigIntToArray(sig.S, 32)];
  },
};

export { randomBytes, hash, aes, ed25519, edBabyJubJub };
