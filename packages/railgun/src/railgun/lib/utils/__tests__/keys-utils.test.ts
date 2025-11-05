import { poseidon } from "@railgun-community/circomlibjs";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import chai, { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before } from "mocha";
import {
  getNoteBlindingKeys,
  getPrivateScalarFromPrivateKey,
  getPublicSpendingKey,
  getPublicViewingKey,
  getRandomScalar,
  getSharedSymmetricKey,
  signED25519,
  signEDDSA,
  unblindNoteKey,
  verifyED25519,
  verifyEDDSA,
} from "../keys-utils";
import { ByteLength, ByteUtils } from "../bytes";
import { MEMO_SENDER_RANDOM_NULL } from "../../models/transaction-constants";
import {
  getNoteBlindingKeysLegacy,
  unblindNoteKeyLegacy,
} from "../keys-utils-legacy";
import { sha256 } from "../hash";
import {
  initCurve25519Promise,
  scalarMultiplyJavascript,
} from "../scalar-multiply";

chai.use(chaiAsPromised);
const { expect } = chai;

let privateSpendingKey: Uint8Array;
let publicSpendingKey: [bigint, bigint];
let privateViewingKey: Uint8Array;
let publicViewingKey: Uint8Array;

// For test comparison with live WASM implementation.
async function getSharedSymmetricKeyJavascript(
  privateKeyPairA: Uint8Array,
  blindedPublicKeyPairB: Uint8Array
) {
  try {
    // Retrieve private scalar from private key
    const scalar: bigint = await getPrivateScalarFromPrivateKey(
      privateKeyPairA
    );

    // Multiply ephemeral key by private scalar to get shared key
    const keyPreimage: Uint8Array = scalarMultiplyJavascript(
      blindedPublicKeyPairB,
      scalar
    );

    // SHA256 hash to get the final key
    const hashed: Uint8Array = ByteUtils.hexStringToBytes(sha256(keyPreimage));

    return hashed;
  } catch (err) {
    console.error(err);

    return undefined;
  }
}

describe("keys-utils", () => {
  before(async () => {
    privateSpendingKey = randomBytes(32);
    publicSpendingKey = getPublicSpendingKey(privateSpendingKey);
    privateViewingKey = randomBytes(32);
    publicViewingKey = await getPublicViewingKey(privateViewingKey);
  });

  it("Should return a random scalar", () => {
    const randomScalar = getRandomScalar();

    expect(randomScalar).to.be.a("bigint");
    expect(ByteUtils.nToHex(randomScalar, ByteLength.UINT_256).length).to.equal(
      64
    );
  });

  it("Should get expected symmetric keys from WASM and Javascript implementations", async () => {
    await expect(initCurve25519Promise).to.not.be.rejectedWith("some error");

    const privateKeyPairA = ByteUtils.hexStringToBytes(
      "0123456789012345678901234567890123456789012345678901234567891234"
    );
    const blindedPublicKeyPairB = ByteUtils.hexStringToBytes(
      "0987654321098765432109876543210987654321098765432109876543210987"
    );
    const symmetricKeyWasm = await getSharedSymmetricKey(
      privateKeyPairA,
      blindedPublicKeyPairB
    );

    expect(symmetricKeyWasm).not.equal(undefined);
    expect(bytesToHex(symmetricKeyWasm as Uint8Array)).to.equal(
      "fbb71adfede43b8a756939500c810d85b16cfbead66d126065639c0cec1fea56"
    );

    const symmetricKeyJavascript = await getSharedSymmetricKeyJavascript(
      privateKeyPairA,
      blindedPublicKeyPairB
    );

    expect(bytesToHex(symmetricKeyWasm as Uint8Array)).to.equal(
      bytesToHex(symmetricKeyJavascript as Uint8Array)
    );
  });

  it("Should create and verify EDDSA signatures", () => {
    const message: bigint = poseidon([1n, 2n]);

    const signature = signEDDSA(privateSpendingKey, message);

    assert.isTrue(verifyEDDSA(message, signature, publicSpendingKey));

    const fakeMessage: bigint = poseidon([2n, 3n]);

    assert.isFalse(verifyEDDSA(fakeMessage, signature, publicSpendingKey));
    assert.isFalse(verifyEDDSA(message, signature, [0n, 1n]));
  });

  it("Should create and verify ED25519 signatures", async () => {
    const message = utf8ToBytes(
      JSON.stringify({ data: "value", more: { data: "another_value" } })
    );

    const signature = await signED25519(message, privateViewingKey);

    assert.isTrue(await verifyED25519(message, signature, publicViewingKey));
    assert.isTrue(
      await verifyED25519(
        bytesToHex(message),
        bytesToHex(signature),
        publicViewingKey
      )
    );

    const fakeMessage = utf8ToBytes("123");

    assert.isFalse(
      await verifyED25519(fakeMessage, signature, publicViewingKey)
    );
  });

  it("Should get shared key from two note keys", async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderRandom = MEMO_SENDER_RANDOM_NULL;
    const { blindedSenderViewingKey, blindedReceiverViewingKey } =
      getNoteBlindingKeys(senderPublic, receiverPublic, random, senderRandom);

    const k1 = await getSharedSymmetricKey(receiver, blindedSenderViewingKey);
    const k2 = await getSharedSymmetricKey(sender, blindedReceiverViewingKey);

    expect(k1).to.eql(k2);
  });

  it("Should get shared key from two note keys, with sender blinding key", async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderRandom = ByteUtils.randomHex(15);
    const { blindedSenderViewingKey, blindedReceiverViewingKey } =
      getNoteBlindingKeys(senderPublic, receiverPublic, random, senderRandom);

    const k1 = await getSharedSymmetricKey(receiver, blindedSenderViewingKey);
    const k2 = await getSharedSymmetricKey(sender, blindedReceiverViewingKey);

    expect(k1).to.eql(k2);
  });

  it("Should unblind note keys", async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderRandom = MEMO_SENDER_RANDOM_NULL;
    const { blindedSenderViewingKey, blindedReceiverViewingKey } =
      getNoteBlindingKeys(senderPublic, receiverPublic, random, senderRandom);

    const senderUnblinded = unblindNoteKey(
      blindedSenderViewingKey,
      random,
      senderRandom
    );
    const receiverUnblinded = unblindNoteKey(
      blindedReceiverViewingKey,
      random,
      senderRandom
    );

    expect(senderPublic).to.eql(senderUnblinded);
    expect(receiverPublic).to.eql(receiverUnblinded);
  });

  it("Should unblind note keys (legacy)", async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderRandom = MEMO_SENDER_RANDOM_NULL;
    const [blindedSenderViewingKey, blindedReceiverViewingKey] =
      getNoteBlindingKeysLegacy(
        senderPublic,
        receiverPublic,
        random,
        senderRandom
      );

    const senderUnblinded = unblindNoteKeyLegacy(
      blindedSenderViewingKey,
      random,
      senderRandom
    );
    const receiverUnblinded = unblindNoteKeyLegacy(
      blindedReceiverViewingKey,
      random,
      senderRandom
    );

    expect(senderPublic).to.eql(senderUnblinded);
    expect(receiverPublic).to.eql(receiverUnblinded);
  });

  it("Should unblind only receiver viewing key, with sender blinding key", async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const senderRandom = ByteUtils.randomHex(15);
    const random = bytesToHex(randomBytes(16));
    const { blindedSenderViewingKey, blindedReceiverViewingKey } =
      getNoteBlindingKeys(senderPublic, receiverPublic, random, senderRandom);

    const senderUnblindedNoBlindingKey = unblindNoteKey(
      blindedSenderViewingKey,
      random,
      MEMO_SENDER_RANDOM_NULL
    );
    const senderUnblindedWithBlindingKey = unblindNoteKey(
      blindedSenderViewingKey,
      random,
      senderRandom
    );
    const receiverUnblindedNoBlindingKey = unblindNoteKey(
      blindedReceiverViewingKey,
      random,
      MEMO_SENDER_RANDOM_NULL
    );
    const receiverUnblindedWithBlindingKey = unblindNoteKey(
      blindedReceiverViewingKey,
      random,
      senderRandom
    );

    expect(senderPublic).to.not.eql(senderUnblindedNoBlindingKey);
    expect(senderPublic).to.eql(senderUnblindedWithBlindingKey);
    expect(receiverPublic).to.not.eql(receiverUnblindedNoBlindingKey);
    expect(receiverPublic).to.eql(receiverUnblindedWithBlindingKey);
  });
});
