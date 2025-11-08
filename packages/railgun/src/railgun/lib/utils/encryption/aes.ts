import { ByteLength, ByteUtils } from '../bytes';
import { BytesData, Ciphertext, CiphertextCTR } from '../../models/formatted-types';
import { isNodejs } from '../runtime';

type Ciphers = Pick<typeof import('crypto'), 'createCipheriv' | 'createDecipheriv'>;

// Browser-safe cipher implementation using Web Crypto API
class BrowserCipher {
  private key: CryptoKey | null = null;
  private keyPromise: Promise<CryptoKey>;
  private iv: Uint8Array;
  private mode: 'gcm' | 'ctr';
  private buffer: Uint8Array[] = [];
  private authTagLength?: number;
  private authTag?: Uint8Array;
  private encryptedBlocks: Uint8Array[] = [];
  private finalized: boolean = false;

  constructor(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength?: number }) {
    this.iv = iv;
    this.mode = algorithm.includes('gcm') ? 'gcm' : 'ctr';
    this.authTagLength = options?.authTagLength;

    const algo = this.mode === 'gcm' 
      ? { name: 'AES-GCM', length: key.length * 8 }
      : { name: 'AES-CTR', length: key.length * 8 };

    this.keyPromise = crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, algo, false, ['encrypt', 'decrypt']);
  }

  private async _ensureKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await this.keyPromise;
    }

    return this.key;
  }

  update(data: Uint8Array): Uint8Array {
    if (this.finalized) {
      // Return pre-computed blocks
      const block = this.encryptedBlocks.shift();

      return block || new Uint8Array(0);
    }

    this.buffer.push(new Uint8Array(data));

    // Return empty for now, actual encryption happens in final()
    return new Uint8Array(0);
  }

  final(): void {
    if (this.finalized) {
      return;
    }

    // Synchronously wait for key and encrypt
    // Note: This is a workaround - Web Crypto is async but we need sync interface
    let keyReady = false;
    let error: Error | null = null;
    let result: Uint8Array | null = null;

    this._ensureKey().then(async (key) => {
      this.key = key;
      const combined = new Uint8Array(this.buffer.reduce((acc, buf) => acc + buf.length, 0));
      let offset = 0;

      for (const buf of this.buffer) {
        combined.set(buf, offset);
        offset += buf.length;
      }

      if (this.mode === 'gcm') {
        const encrypted = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: this.iv.buffer as ArrayBuffer,
            tagLength: (this.authTagLength || 16) * 8,
          },
          key,
          combined.buffer as ArrayBuffer
        );
        const encryptedData = new Uint8Array(encrypted);
        const tagLength = this.authTagLength || 16;

        this.authTag = encryptedData.slice(-tagLength);
        result = encryptedData.slice(0, -tagLength);
      } else {
        const encrypted = await crypto.subtle.encrypt(
          {
            name: 'AES-CTR',
            counter: this.iv.buffer as ArrayBuffer,
            length: 128,
          },
          key,
          combined.buffer as ArrayBuffer
        );

        result = new Uint8Array(encrypted);
      }

      keyReady = true;
    }).catch((err) => {
      error = err;
      keyReady = true;
    });

    // Busy wait for result (not ideal but needed for sync compatibility)
    const start = Date.now();

    while (!keyReady && Date.now() - start < 1000) {
      // Wait up to 1 second
    }

    if (error) {
      throw error;
    }

    if (!result) {
      throw new Error('Encryption timeout or failed');
    }

    // Split result into blocks matching input blocks
    const finalResult: Uint8Array = result as Uint8Array;
    let offset = 0;

    for (const buf of this.buffer) {
      this.encryptedBlocks.push(finalResult.slice(offset, offset + buf.length));
      offset += buf.length;
    }

    this.finalized = true;
  }

  getAuthTag(): Uint8Array {
    if (!this.authTag) {
      throw new Error('Auth tag not available');
    }

    return this.authTag;
  }
}

class BrowserDecipher {
  private key: CryptoKey | null = null;
  private keyPromise: Promise<CryptoKey>;
  private iv: Uint8Array;
  private mode: 'gcm' | 'ctr';
  private buffer: Uint8Array[] = [];
  private authTagLength?: number;
  private authTag?: Uint8Array;
  private decryptedBlocks: Uint8Array[] = [];
  private finalized: boolean = false;

  constructor(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength?: number }) {
    this.iv = iv;
    this.mode = algorithm.includes('gcm') ? 'gcm' : 'ctr';
    this.authTagLength = options?.authTagLength;

    const algo = this.mode === 'gcm' 
      ? { name: 'AES-GCM', length: key.length * 8 }
      : { name: 'AES-CTR', length: key.length * 8 };

    this.keyPromise = crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, algo, false, ['encrypt', 'decrypt']);
  }

  private async _ensureKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await this.keyPromise;
    }

    return this.key;
  }

  setAuthTag(tag: Uint8Array): void {
    this.authTag = tag;
  }

  update(data: Uint8Array): Uint8Array {
    if (this.finalized) {
      const block = this.decryptedBlocks.shift();

      return block || new Uint8Array(0);
    }

    this.buffer.push(new Uint8Array(data));

    return new Uint8Array(0);
  }

  final(): void {
    if (this.finalized) {
      return;
    }

    let keyReady = false;
    let error: Error | null = null;
    let result: Uint8Array | null = null;

    this._ensureKey().then(async (key) => {
      this.key = key;
      const combined = new Uint8Array(this.buffer.reduce((acc, buf) => acc + buf.length, 0));
      let offset = 0;

      for (const buf of this.buffer) {
        combined.set(buf, offset);
        offset += buf.length;
      }

      if (this.mode === 'gcm') {
        if (!this.authTag) {
          throw new Error('Auth tag must be set for GCM mode');
        }

        const ciphertextWithTag = new Uint8Array(combined.length + this.authTag.length);

        ciphertextWithTag.set(combined, 0);
        ciphertextWithTag.set(this.authTag, combined.length);

        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: this.iv.buffer as ArrayBuffer,
            tagLength: (this.authTagLength || 16) * 8,
          },
          key,
          ciphertextWithTag.buffer as ArrayBuffer
        );

        result = new Uint8Array(decrypted);
      } else {
        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-CTR',
            counter: this.iv.buffer as ArrayBuffer,
            length: 128,
          },
          key,
          combined.buffer as ArrayBuffer
        );

        result = new Uint8Array(decrypted);
      }

      keyReady = true;
    }).catch((err) => {
      error = err;
      keyReady = true;
    });

    const start = Date.now();

    while (!keyReady && Date.now() - start < 1000) {
      // Wait up to 1 second
    }

    if (error) {
      throw error;
    }

    if (!result) {
      throw new Error('Decryption timeout or failed');
    }

    // Split result into blocks matching input blocks
    const finalResult: Uint8Array = result as Uint8Array;
    let offset = 0;

    for (const buf of this.buffer) {
      this.decryptedBlocks.push(finalResult.slice(offset, offset + buf.length));
      offset += buf.length;
    }

    this.finalized = true;
  }
}

// Browser-safe cipher factory
function createBrowserCiphers(): Ciphers {
  return {
    createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength?: number }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new BrowserCipher(algorithm, key, iv, options) as any;
    },
    createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength?: number }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new BrowserDecipher(algorithm, key, iv, options) as any;
    },
  } as Ciphers;
}

let ciphers: Ciphers | null = null;

function getCiphers(): Ciphers {
  if (ciphers) {
    return ciphers;
  }

  if (isNodejs) {
    try {
      // @ts-expect-error - dynamic require to avoid webpack bundling
       
      const nodeModule = typeof __non_webpack_require__ !== 'undefined' 
        ? __non_webpack_require__('node:module')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        : require('node:module');
      const requireFn = nodeModule.createRequire(import.meta.url);

      ciphers = requireFn('crypto') as Ciphers;

      return ciphers;
    } catch {
      throw new Error('Failed to load Node.js crypto module');
    }
  } else {
    // In browser, use Web Crypto API implementation
    ciphers = createBrowserCiphers();

    return ciphers;
  }
}

// Initialize eagerly
try {
  getCiphers();
} catch {
  // Will be initialized on first use
}

const { createCipheriv, createDecipheriv } = {
  get createCipheriv() {
    return getCiphers().createCipheriv;
  },
  get createDecipheriv() {
    return getCiphers().createDecipheriv;
  }
} as Ciphers;

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
  static encryptCTR(plaintext: string[], key: string | Uint8Array): CiphertextCTR {
    // If types are strings, convert to bytes array
    const keyFormatted = typeof key === 'string' ? ByteUtils.fastHexToBytes(key) : key;

    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
      );
    }

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
  static decryptCTR(ciphertext: CiphertextCTR, key: string | Uint8Array): string[] {
    // If types are strings, convert to bytes array
    const keyFormatted = typeof key === 'string' ? ByteUtils.fastHexToBytes(key) : key;

    if (keyFormatted.byteLength !== 32) {
      throw new Error(
        `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
      );
    }

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
