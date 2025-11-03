import { ByteLength, ByteUtils } from "../bytes";
import {
  BytesData,
  Ciphertext,
  CiphertextCTR,
} from "../../models/formatted-types";
import { isNodejs } from "../runtime";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

type Ciphers = Pick<
  typeof import("crypto"),
  "createCipheriv" | "createDecipheriv"
>;

const { createCipheriv, createDecipheriv } = isNodejs
  ? (require("crypto") as Ciphers)
  : (require("browserify-aes/browser") as Ciphers);

export class AES {
  static getRandomIV() {
    return ByteUtils.randomHex(16);
  }

  /**
   * Encrypt blocks of data with AES-256-GCM
   * @param plaintext - plaintext to encrypt
   * @param key - key to encrypt with
   * @returns ciphertext bundle
   */
  static encryptGCM(plaintext: string[], key: string | Uint8Array): Ciphertext {
    // If types are strings, convert to bytes array
    const keyFormatted =
      typeof key === "string" ? ByteUtils.fastHexToBytes(key) : key;

    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`
      );
    }

    const iv = AES.getRandomIV();
    const ivFormatted = ByteUtils.fastHexToBytes(iv);

    // Initialize cipher
    const cipher = createCipheriv("aes-256-gcm", keyFormatted, ivFormatted, {
      authTagLength: 16,
    });

    // Loop through data blocks and encrypt
    const data = new Array<string>(plaintext.length);

    for (let i = 0; i < plaintext.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(
        cipher.update(ByteUtils.fastHexToBytes(ByteUtils.strip0x(plaintext[i])))
      );
    }
    cipher.final();

    const tag = cipher.getAuthTag();
    const tagFormatted = new Uint8Array(ByteUtils.arrayify(tag));

    // Return encrypted data bundle
    return {
      iv: ByteUtils.formatToByteLength(ivFormatted, ByteLength.UINT_128, false),
      tag: ByteUtils.formatToByteLength(
        tagFormatted,
        ByteLength.UINT_128,
        false
      ),
      data,
    };
  }

  /**
   * Decrypts AES-256-GCM encrypted data
   * On failure, it throws `Unsupported state or unable to authenticate data`
   * @param ciphertext - ciphertext bundle to decrypt
   * @param key - key to decrypt with
   * @returns - plaintext
   */
  static decryptGCM(
    ciphertext: Ciphertext,
    key: string | Uint8Array
  ): BytesData[] {
    try {
      // Ensure that inputs are Uint8Arrays of the correct length
      const keyFormatted =
        typeof key === "string"
          ? ByteUtils.fastHexToBytes(ByteUtils.padToLength(key, 32) as string)
          : key;

      if (keyFormatted.byteLength !== 32) {
        throw new Error(
          `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`
        );
      }

      const ivFormatted = ByteUtils.fastHexToBytes(
        ByteUtils.trim(ciphertext.iv, 16) as string
      );
      const tagFormatted = ByteUtils.fastHexToBytes(
        ByteUtils.trim(ciphertext.tag, 16) as string
      );

      if (ivFormatted.byteLength !== 16) {
        throw new Error(
          `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`
        );
      }

      if (tagFormatted.byteLength !== 16) {
        throw new Error(
          `Invalid tag length. Expected 16 bytes. Received ${tagFormatted.byteLength} bytes.`
        );
      }

      // Initialize decipher
      const decipher = createDecipheriv(
        "aes-256-gcm",
        keyFormatted,
        ivFormatted,
        {
          authTagLength: 16,
        }
      );

      // It will throw exception if the decryption fails due to invalid key, iv, tag
      decipher.setAuthTag(tagFormatted);

      // Loop through ciphertext and decrypt then return
      const data = new Array<string>(ciphertext.data.length);

      for (let i = 0; i < ciphertext.data.length; i += 1) {
        data[i] = ByteUtils.fastBytesToHex(
          decipher.update(ByteUtils.fastHexToBytes(ciphertext.data[i]))
        );
      }
      decipher.final();

      return data;
    } catch (cause) {
      throw new Error("Unable to decrypt ciphertext.", { cause });
    }
  }

  /**
   * Encrypt blocks of data with AES-256-CTR
   * @param plaintext - plaintext to encrypt
   * @param key - key to encrypt with
   * @returns ciphertext bundle
   */
  static encryptCTR(
    plaintext: string[],
    key: string | Uint8Array
  ): CiphertextCTR {
    // If types are strings, convert to bytes array
    const keyFormatted =
      typeof key === "string" ? ByteUtils.fastHexToBytes(key) : key;

    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`
      );
    }

    const iv = AES.getRandomIV();
    const ivFormatted = ByteUtils.fastHexToBytes(iv);

    // Initialize cipher
    const cipher = createCipheriv("aes-256-ctr", keyFormatted, ivFormatted);

    // Loop through data blocks and encrypt
    const data = new Array<string>(plaintext.length);

    for (let i = 0; i < plaintext.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(
        cipher.update(ByteUtils.fastHexToBytes(plaintext[i]))
      );
    }
    cipher.final();

    // Return encrypted data bundle
    return {
      iv: ByteUtils.formatToByteLength(ivFormatted, ByteLength.UINT_128, false),
      data,
    };
  }

  /**
   * Decrypts AES-256-CTR encrypted data
   * On failure, it throws `Unsupported state or unable to authenticate data`
   * @param ciphertext - ciphertext bundle to decrypt
   * @param key - key to decrypt with
   * @returns - plaintext
   */
  static decryptCTR(
    ciphertext: CiphertextCTR,
    key: string | Uint8Array
  ): string[] {
    // If types are strings, convert to bytes array
    const keyFormatted =
      typeof key === "string" ? ByteUtils.fastHexToBytes(key) : key;

    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`
      );
    }

    const ivFormatted = ByteUtils.fastHexToBytes(ciphertext.iv);

    if (ivFormatted.byteLength !== 16) {
      throw new Error(
        `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`
      );
    }

    // Initialize decipher
    const decipher = createDecipheriv("aes-256-ctr", keyFormatted, ivFormatted);

    // Loop through ciphertext and decrypt then return
    const data = new Array<string>(ciphertext.data.length);

    for (let i = 0; i < ciphertext.data.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(
        decipher.update(ByteUtils.fastHexToBytes(ciphertext.data[i]))
      );
    }
    decipher.final();

    return data;
  }
}
