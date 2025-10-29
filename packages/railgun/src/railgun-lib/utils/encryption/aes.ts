import { ByteLength, ByteUtils } from '../bytes';
import { BytesData, Ciphertext, CiphertextCTR } from '../../models/formatted-types';
import { useBrowserCrypto, getNodeCiphers } from '../platform';

// Browser-compatible implementations using Web Crypto API
async function browserEncryptGCM(plaintext: string[], key: Uint8Array): Promise<Ciphertext> {
  const iv = ByteUtils.fastHexToBytes(ByteUtils.randomHex(16));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const data = new Array<string>(plaintext.length);
  let tag: Uint8Array | undefined;

  for (let i = 0; i < plaintext.length; i += 1) {
    const plaintextBytes = ByteUtils.fastHexToBytes(ByteUtils.strip0x(plaintext[i]));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      cryptoKey,
      plaintextBytes
    );

    // Web Crypto API returns ciphertext with tag appended
    const encryptedArray = new Uint8Array(encrypted);
    const ciphertextOnly = encryptedArray.slice(0, -16);
    data[i] = ByteUtils.fastBytesToHex(ciphertextOnly);

    // Extract tag from first encryption
    if (i === 0) {
      tag = encryptedArray.slice(-16);
    }
  }

  if (!tag) {
    throw new Error('Failed to extract authentication tag');
  }

  return {
    iv: ByteUtils.formatToByteLength(iv, ByteLength.UINT_128, false),
    tag: ByteUtils.formatToByteLength(tag, ByteLength.UINT_128, false),
    data,
  };
}

async function browserDecryptGCM(ciphertext: Ciphertext, key: Uint8Array): Promise<BytesData[]> {
  try {
    const ivFormatted = ByteUtils.fastHexToBytes(ByteUtils.trim(ciphertext.iv, 16) as string);
    const tagFormatted = ByteUtils.fastHexToBytes(ByteUtils.trim(ciphertext.tag, 16) as string);

    if (ivFormatted.byteLength !== 16) {
      throw new Error(
        `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`,
      );
    }
    if (tagFormatted.byteLength !== 16) {
      throw new Error(
        `Invalid tag length. Expected 16 bytes. Received ${tagFormatted.byteLength} bytes.`,
      );
    }

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const data = new Array<string>(ciphertext.data.length);
    for (let i = 0; i < ciphertext.data.length; i += 1) {
      const ciphertextBytes = ByteUtils.fastHexToBytes(ciphertext.data[i]);
      // Web Crypto API expects ciphertext + tag
      const combined = new Uint8Array(ciphertextBytes.length + tagFormatted.length);
      combined.set(ciphertextBytes);
      combined.set(tagFormatted, ciphertextBytes.length);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivFormatted, tagLength: 128 },
        cryptoKey,
        combined
      );
      data[i] = ByteUtils.fastBytesToHex(new Uint8Array(decrypted));
    }
    return data;
  } catch (cause) {
    throw new Error('Unable to decrypt ciphertext.', { cause });
  }
}

async function browserEncryptCTR(plaintext: string[], key: Uint8Array): Promise<CiphertextCTR> {
  const iv = ByteUtils.fastHexToBytes(ByteUtils.randomHex(16));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CTR', counter: iv, length: 128 },
    false,
    ['encrypt']
  );

  const data = new Array<string>(plaintext.length);
  for (let i = 0; i < plaintext.length; i += 1) {
    const plaintextBytes = ByteUtils.fastHexToBytes(plaintext[i]);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CTR', counter: iv, length: 128 },
      cryptoKey,
      plaintextBytes
    );
    data[i] = ByteUtils.fastBytesToHex(new Uint8Array(encrypted));
  }

  return {
    iv: ByteUtils.formatToByteLength(iv, ByteLength.UINT_128, false),
    data,
  };
}

async function browserDecryptCTR(ciphertext: CiphertextCTR, key: Uint8Array): Promise<string[]> {
  const ivFormatted = ByteUtils.fastHexToBytes(ciphertext.iv);
  if (ivFormatted.byteLength !== 16) {
    throw new Error(
      `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`,
    );
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CTR', counter: ivFormatted, length: 128 },
    false,
    ['decrypt']
  );

  const data = new Array<string>(ciphertext.data.length);
  for (let i = 0; i < ciphertext.data.length; i += 1) {
    const ciphertextBytes = ByteUtils.fastHexToBytes(ciphertext.data[i]);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: ivFormatted, length: 128 },
      cryptoKey,
      ciphertextBytes
    );
    data[i] = ByteUtils.fastBytesToHex(new Uint8Array(decrypted));
  }
  return data;
}

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
  static async encryptGCM(plaintext: string[], key: string | Uint8Array): Promise<Ciphertext> {
    // If types are strings, convert to bytes array
    const keyFormatted = typeof key === 'string' ? ByteUtils.fastHexToBytes(key) : key;
    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
      );
    }

    // Use browser implementation if in browser environment
    if (useBrowserCrypto) {
      return browserEncryptGCM(plaintext, keyFormatted);
    }

    const { createCipheriv } = getNodeCiphers();
    const iv = AES.getRandomIV();
    const ivFormatted = ByteUtils.fastHexToBytes(iv);

    // Initialize cipher
    const cipher = createCipheriv('aes-256-gcm', keyFormatted, ivFormatted, {
      authTagLength: 16,
    });

    // Loop through data blocks and encrypt
    const data = new Array<string>(plaintext.length);
    for (let i = 0; i < plaintext.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(
        cipher.update(ByteUtils.fastHexToBytes(ByteUtils.strip0x(plaintext[i]))),
      );
    }
    cipher.final();

    const tag = cipher.getAuthTag();
    const tagFormatted = new Uint8Array(ByteUtils.arrayify(tag));

    // Return encrypted data bundle
    return {
      iv: ByteUtils.formatToByteLength(ivFormatted, ByteLength.UINT_128, false),
      tag: ByteUtils.formatToByteLength(tagFormatted, ByteLength.UINT_128, false),
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
  static async decryptGCM(ciphertext: Ciphertext, key: string | Uint8Array): Promise<BytesData[]> {
    try {
      // Ensure that inputs are Uint8Arrays of the correct length
      const keyFormatted =
        typeof key === 'string'
          ? ByteUtils.fastHexToBytes(ByteUtils.padToLength(key, 32) as string)
          : key;
      if (keyFormatted.byteLength !== 32) {
        throw new Error(
          `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
        );
      }

      // Use browser implementation if in browser environment
      if (useBrowserCrypto) {
        return browserDecryptGCM(ciphertext, keyFormatted);
      }

      const { createDecipheriv } = getNodeCiphers();
      const ivFormatted = ByteUtils.fastHexToBytes(ByteUtils.trim(ciphertext.iv, 16) as string);
      const tagFormatted = ByteUtils.fastHexToBytes(ByteUtils.trim(ciphertext.tag, 16) as string);
      if (ivFormatted.byteLength !== 16) {
        throw new Error(
          `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`,
        );
      }
      if (tagFormatted.byteLength !== 16) {
        throw new Error(
          `Invalid tag length. Expected 16 bytes. Received ${tagFormatted.byteLength} bytes.`,
        );
      }

      // Initialize decipher
      const decipher = createDecipheriv('aes-256-gcm', keyFormatted, ivFormatted, {
        authTagLength: 16,
      });

      // It will throw exception if the decryption fails due to invalid key, iv, tag
      decipher.setAuthTag(tagFormatted);

      // Loop through ciphertext and decrypt then return
      const data = new Array<string>(ciphertext.data.length);
      for (let i = 0; i < ciphertext.data.length; i += 1) {
        data[i] = ByteUtils.fastBytesToHex(
          decipher.update(ByteUtils.fastHexToBytes(ciphertext.data[i])),
        );
      }
      decipher.final();
      return data;
    } catch (cause) {

      throw new Error('Unable to decrypt ciphertext.', { cause });
    }
  }

  /**
   * Encrypt blocks of data with AES-256-CTR
   * @param plaintext - plaintext to encrypt
   * @param key - key to encrypt with
   * @returns ciphertext bundle
   */
  static async encryptCTR(plaintext: string[], key: string | Uint8Array): Promise<CiphertextCTR> {
    // If types are strings, convert to bytes array
    const keyFormatted = typeof key === 'string' ? ByteUtils.fastHexToBytes(key) : key;
    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
      );
    }

    // Use browser implementation if in browser environment
    if (useBrowserCrypto) {
      return browserEncryptCTR(plaintext, keyFormatted);
    }

    const { createCipheriv } = getNodeCiphers();
    const iv = AES.getRandomIV();
    const ivFormatted = ByteUtils.fastHexToBytes(iv);

    // Initialize cipher
    const cipher = createCipheriv('aes-256-ctr', keyFormatted, ivFormatted);

    // Loop through data blocks and encrypt
    const data = new Array<string>(plaintext.length);
    for (let i = 0; i < plaintext.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(cipher.update(ByteUtils.fastHexToBytes(plaintext[i])));
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
  static async decryptCTR(ciphertext: CiphertextCTR, key: string | Uint8Array): Promise<string[]> {
    // If types are strings, convert to bytes array
    const keyFormatted = typeof key === 'string' ? ByteUtils.fastHexToBytes(key) : key;
    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
      );
    }

    // Use browser implementation if in browser environment
    if (useBrowserCrypto) {
      return browserDecryptCTR(ciphertext, keyFormatted);
    }

    const { createDecipheriv } = getNodeCiphers();
    const ivFormatted = ByteUtils.fastHexToBytes(ciphertext.iv);
    if (ivFormatted.byteLength !== 16) {
      throw new Error(
        `Invalid iv length. Expected 16 bytes. Received ${ivFormatted.byteLength} bytes.`,
      );
    }

    // Initialize decipher
    const decipher = createDecipheriv('aes-256-ctr', keyFormatted, ivFormatted);

    // Loop through ciphertext and decrypt then return
    const data = new Array<string>(ciphertext.data.length);
    for (let i = 0; i < ciphertext.data.length; i += 1) {
      data[i] = ByteUtils.fastBytesToHex(
        decipher.update(ByteUtils.fastHexToBytes(ciphertext.data[i])),
      );
    }
    decipher.final();
    return data;
  }
}
