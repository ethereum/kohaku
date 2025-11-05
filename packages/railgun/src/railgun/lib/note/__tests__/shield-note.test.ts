import { poseidon } from "@railgun-community/circomlibjs";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { randomBytes } from "@noble/hashes/utils";
import { ByteLength, ByteUtils } from "../../utils/bytes";
import { getPublicViewingKey, getRandomScalar } from "../../utils/keys-utils";
import { config } from "../../test/config.test";
import { TokenType } from "../../models/formatted-types";
import { ShieldNote } from "../shield-note";
import { ShieldNoteERC20 } from "../erc20/shield-note-erc20";

chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN_ADDRESS: string = ByteUtils.formatToByteLength(
  config.contracts.rail,
  ByteLength.Address,
  true
);

let mpk: bigint;
let vpk: Uint8Array;
let shield: ShieldNote;

describe("shield-note", () => {
  it("Should get expected signature message for shieldPrivateKey", () => {
    expect(ShieldNote.getShieldPrivateKeySignatureMessage()).to.equal(
      "RAILGUN_SHIELD"
    );
  });

  it("Should create shield note", () => {
    mpk = getRandomScalar();
    const rand = ByteUtils.randomHex(16);

    shield = new ShieldNoteERC20(mpk, rand, 1000n, TOKEN_ADDRESS);
    const { tokenAddress, tokenType, tokenSubID } = shield.tokenData;

    expect(tokenAddress).to.equal(TOKEN_ADDRESS);
    expect(tokenType).to.equal(TokenType.ERC20);
    expect(BigInt(tokenSubID)).to.equal(0n);
    const npk: bigint = poseidon([mpk, ByteUtils.hexToBigInt(rand)]);

    expect(shield.notePublicKey).to.equal(npk);
    expect(shield.value).to.equal(1000n);
  });

  it("Should validate length of random parameter", () => {
    const msg = /Random must be length 32.*/;

    mpk = getRandomScalar();
    expect(
      () =>
        new ShieldNoteERC20(mpk, ByteUtils.randomHex(15), 1000n, TOKEN_ADDRESS)
    ).to.throw(msg);
    expect(
      () =>
        new ShieldNoteERC20(mpk, ByteUtils.randomHex(17), 1000n, TOKEN_ADDRESS)
    ).to.throw(msg);
    expect(
      new ShieldNoteERC20(mpk, ByteUtils.randomHex(16), 1000n, TOKEN_ADDRESS)
    ).to.be.an.instanceOf(ShieldNote);
  });

  it("Should serialize ShieldNote to preimage and ciphertext", async () => {
    mpk = getRandomScalar();
    vpk = randomBytes(32);
    const viewingPublicKey = await getPublicViewingKey(vpk);
    const rand = ByteUtils.randomHex(16);

    shield = new ShieldNoteERC20(mpk, rand, 1000n, TOKEN_ADDRESS);
    const shieldPrivateKey = ByteUtils.hexToBytes(ByteUtils.randomHex(32));
    const { preimage, ciphertext } = await shield.serialize(
      shieldPrivateKey,
      viewingPublicKey
    );

    expect(ByteUtils.hexlify(preimage.npk)).length(64);
    expect(preimage.token.tokenAddress).to.equal(TOKEN_ADDRESS);
    expect(preimage.value).to.equal(1000n);
    expect(ciphertext.encryptedBundle).length(3);
  });
});
