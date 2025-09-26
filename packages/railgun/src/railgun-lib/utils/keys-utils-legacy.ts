import { utils as utilsEd25519, Point, CURVE } from '@noble/ed25519';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ByteLength, ByteUtils } from './bytes';
import { sha256 } from './hash';
import { adjustBytes25519, getPrivateScalarFromPrivateKey } from './keys-utils';
import { scalarMultiplyWasmFallbackToJavascript } from './scalar-multiply';

function normalizeRandomLegacy(random: string): bigint {
  // Hash with sha256 to get a uniform random 32 bytes of data
  const randomArray = ByteUtils.hexToBytes(sha256(random));

  // NOTE: The bits adjustment is no longer required to function as an X25519 integer is not used
  // These steps are still taken to preserve compatibility with older transactions

  const adjustedBytes = adjustBytes25519(randomArray, 'le');

  // Return mod n to fit to curve point
  return BigInt(`0x${bytesToHex(adjustedBytes)}`) % CURVE.n;
}

function getCommitmentBlindingKeyLegacy(random: string, senderRandom: string): bigint {
  // XOR public and spender blinding key to get commitment blinding key
  // XOR is used because a 0 value on the sender blinding key will result in identical public and
  // commitment blinding keys, allowing the receiver to reverse the multiplier operation
  const commitmentBlindingKey = ByteUtils.hexToBigInt(random) ^ ByteUtils.hexToBigInt(senderRandom);

  const commitmentBlindingKeyHex = ByteUtils.nToHex(commitmentBlindingKey, ByteLength.UINT_256);

  // Adjust random value to use as blinding key to prevent external observers from being able to
  // reverse the multiplication. The random value here is a value only known to the sender and
  // receiver
  const commitmentBlindingKeyNormalized = normalizeRandomLegacy(commitmentBlindingKeyHex);

  // For each blinding operation both sender and receiver public viewing keys must be multiplied by
  // the same value to preserve symmetry in relation to the respective private key to allow shared
  // key generation
  return commitmentBlindingKeyNormalized;
}

function unblindNoteKeyLegacy(
  ephemeralKey: Uint8Array,
  random: string,
  senderRandom: string,
): Optional<Uint8Array> {
  try {
    const commitmentBlindingKey = getCommitmentBlindingKeyLegacy(random, senderRandom);

    // Create curve point instance from ephemeral key bytes
    const point = Point.fromHex(bytesToHex(ephemeralKey));

    // Invert the scalar to undo blinding multiplication operation
    const inverse = utilsEd25519.invert(commitmentBlindingKey, CURVE.n);

    // Unblind by multiplying by the inverted scalar
    const unblinded = point.multiply(inverse);

    return unblinded.toRawBytes();
  } catch {
    return undefined;
  }
}

function getNoteBlindingKeysLegacy(
  senderViewingPublicKey: Uint8Array,
  receiverViewingPublicKey: Uint8Array,
  random: string,
  senderBlindingKey: string,
): [Uint8Array, Uint8Array] {
  const commitmentBlindingKey = getCommitmentBlindingKeyLegacy(random, senderBlindingKey);

  // Multiply both sender and receiver viewing public keys with the public blinding key
  // The pub blinding key is only known to the sender and receiver preventing external
  // observers from being able to invert and retrieve the original value
  const ephemeralKeyReceiver = Point.fromHex(bytesToHex(senderViewingPublicKey))
    .multiply(commitmentBlindingKey)
    .toRawBytes();
  const ephemeralKeySender = Point.fromHex(bytesToHex(receiverViewingPublicKey))
    .multiply(commitmentBlindingKey)
    .toRawBytes();

  // Return blinded keys
  return [ephemeralKeyReceiver, ephemeralKeySender];
}

async function getSharedSymmetricKeyLegacy(
  privateKeyPairA: Uint8Array,
  blindedPublicKeyPairB: Uint8Array,
): Promise<Optional<Uint8Array>> {
  try {
    // Retrieve private scalar from private key
    const scalar = await getPrivateScalarFromPrivateKey(privateKeyPairA);

    // Multiply ephemeral key by private scalar to get shared key
    return scalarMultiplyWasmFallbackToJavascript(blindedPublicKeyPairB, scalar);
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

export { getSharedSymmetricKeyLegacy, unblindNoteKeyLegacy, getNoteBlindingKeysLegacy };
