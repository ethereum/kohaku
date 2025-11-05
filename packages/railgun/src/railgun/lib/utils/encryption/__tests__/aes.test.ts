import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ByteLength, ByteUtils } from "../../bytes";
import { AES } from "../aes";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("aes", () => {
  it("Should test the correctness of encrypt/decrypt with AES-256-GCM", () => {
    const plaintext: string[] = [];

    for (let i = 0; i < 8; i += 1) plaintext.push(ByteUtils.randomHex(32));
    const key = ByteUtils.randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      AES.decryptGCM(
        {
          iv: ciphertext.iv,
          tag: ciphertext.tag,
          data: ciphertext.data,
        },
        key
      )
    ).to.deep.equal(plaintext);
  });

  it("Should reject invalid tag", () => {
    const plaintext: string[] = [];

    for (let i = 0; i < 8; i += 1) plaintext.push(ByteUtils.randomHex(32));
    const key = ByteUtils.randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);
    const randomTag = ByteUtils.randomHex(16);

    // Test decryption returns correct plaintext array
    expect(() =>
      AES.decryptGCM(
        {
          iv: ciphertext.iv,
          tag: randomTag,
          data: ciphertext.data,
        },
        key
      )
    ).to.throw("Unable to decrypt ciphertext.");
  });

  it("Should encrypt and decrypt GCM data", () => {
    const randomValue = ByteUtils.randomHex();
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = AES.encryptGCM(
      [randomValue],
      ByteUtils.nToHex(viewingPrivateKey, ByteLength.UINT_256)
    );
    const decrypted = AES.decryptGCM(
      ciphertext,
      ByteUtils.nToHex(viewingPrivateKey, ByteLength.UINT_256)
    );

    expect(randomValue).to.equal(decrypted[0]);
  });

  it("Should test the correctness of encrypt/decrypt with AES-256-CTR", () => {
    const plaintext: string[] = [];

    for (let i = 0; i < 16; i += 1) plaintext.push(ByteUtils.randomHex(32));
    const key = ByteUtils.randomHex(32);
    const ciphertext = AES.encryptCTR(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      AES.decryptCTR(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key
      )
    ).to.deep.equal(plaintext);
  });

  it("Should encrypt and decrypt CTR data", () => {
    const plaintext = ByteUtils.randomHex(32);
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = AES.encryptCTR(
      [plaintext],
      ByteUtils.nToHex(viewingPrivateKey, ByteLength.UINT_256)
    );
    const decrypted = AES.decryptCTR(
      ciphertext,
      ByteUtils.nToHex(viewingPrivateKey, ByteLength.UINT_256)
    );

    expect(plaintext).to.equal(decrypted[0]);
  });
});
