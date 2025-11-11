import { xchacha20, xchacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha2';
import { ByteUtils } from '../bytes';
import { CiphertextXChaCha, XChaChaEncryptionAlgorithm } from '../../models/formatted-types';

export class XChaCha20 {
  static getRandomIV(): string {
    const random = ByteUtils.randomHex(16);

    if (random.length !== 32) {
      throw new Error('Incorrect nonce length');
    }

    return random;
  }

  static encryptChaCha20(plaintext: string, key: Uint8Array): CiphertextXChaCha {
    const nonce = this.getRandomIV();
    const nonceExtended = sha256(nonce).slice(0, 24);
    const plaintextFormatted = ByteUtils.fastHexToBytes(plaintext);
    const bundleBytes = xchacha20(key, nonceExtended, plaintextFormatted);
    const bundle = ByteUtils.fastBytesToHex(bundleBytes);

    return {
      algorithm: XChaChaEncryptionAlgorithm.XChaCha,
      nonce,
      bundle,
    };
  }

  static decryptChaCha20(ciphertext: CiphertextXChaCha, key: Uint8Array): string {
    if (ciphertext.algorithm !== XChaChaEncryptionAlgorithm.XChaCha) {
      throw new Error(`Invalid ciphertext for XChaCha: ${ciphertext.algorithm}`);
    }

    const nonceExtended = sha256(ciphertext.nonce).slice(0, 24);
    const bytes = xchacha20(key, nonceExtended, ByteUtils.fastHexToBytes(ciphertext.bundle));
    const plaintext = ByteUtils.fastBytesToHex(bytes);

    return plaintext;
  }

  static encryptChaCha20Poly1305(plaintext: string, key: Uint8Array): CiphertextXChaCha {
    const nonce = this.getRandomIV();
    const nonceExtended = sha256(nonce).slice(0, 24);
    const encrypter = xchacha20poly1305(key, nonceExtended);
    const plaintextFormatted = ByteUtils.fastHexToBytes(plaintext);
    const bundleBytes = encrypter.encrypt(plaintextFormatted);
    const bundle = ByteUtils.fastBytesToHex(bundleBytes);

    return {
      algorithm: XChaChaEncryptionAlgorithm.XChaChaPoly1305,
      nonce,
      bundle,
    };
  }

  static decryptChaCha20Poly1305(ciphertext: CiphertextXChaCha, key: Uint8Array): string {
    if (ciphertext.algorithm !== XChaChaEncryptionAlgorithm.XChaChaPoly1305) {
      throw new Error(`Invalid ciphertext for XChaChaPoly1305: ${ciphertext.algorithm}`);
    }

    const nonceExtended = sha256(ciphertext.nonce).slice(0, 24);
    const encrypter = xchacha20poly1305(key, nonceExtended);
    const bundleFormatted = ByteUtils.fastHexToBytes(ciphertext.bundle);
    const plaintext = ByteUtils.fastBytesToHex(encrypter.decrypt(bundleFormatted));

    return plaintext;
  }
}
