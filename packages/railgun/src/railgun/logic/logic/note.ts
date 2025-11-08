import {
  bigIntToArray,
  hexStringToArray,
  arrayToByteLength,
  combine,
  padToLength,
  railgunBase37,
  arrayToBigInt,
  arrayToHexString,
} from '../global/bytes';
import { SNARK_SCALAR_FIELD } from '../global/constants';
import { hash, edBabyJubJub, aes, ed25519, randomBytes } from '../global/crypto';

export enum TokenType {
  'ERC20' = 0,
  'ERC721' = 1,
  'ERC1155' = 2,
}

export type SerializedNoteData = {
  value: string;
  tokenData: {
    tokenType: TokenType;
    tokenAddress: string;
    tokenSubID: string;
  };
  memo: string;
  random: string;
}

export interface TokenData {
  tokenType: TokenType;
  tokenAddress: string;
  tokenSubID: bigint;
}

export interface CommitmentCiphertext {
  ciphertext: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  blindedSenderViewingKey: Uint8Array;
  blindedReceiverViewingKey: Uint8Array;
  annotationData: Uint8Array;
  memo: Uint8Array;
}

export interface ShieldCiphertext {
  // IV shared (16 bytes), tag (16 bytes), random (16 bytes), IV sender (16 bytes), receiver viewing public key (32 bytes)
  encryptedBundle: [Uint8Array, Uint8Array, Uint8Array];
  shieldKey: Uint8Array;
}

export interface CommitmentPreimage {
  npk: Uint8Array;
  token: TokenData;
  value: bigint;
}

export interface ShieldRequest {
  preimage: CommitmentPreimage;
  ciphertext: ShieldCiphertext;
}

/**
 * Gets token ID from token data
 *
 * @param tokenData - token data to get ID from
 * @returns token ID
 */
function getTokenID(tokenData: TokenData): Uint8Array {
  // ERC20 tokenID is just the address
  if (tokenData.tokenType === TokenType.ERC20) {
    return arrayToByteLength(hexStringToArray(tokenData.tokenAddress), 32);
  }

  // Other token types are the keccak256 hash of the token data
  return bigIntToArray(
    arrayToBigInt(
      hash.keccak256(
        combine([
          bigIntToArray(BigInt(tokenData.tokenType), 32),
          padToLength(hexStringToArray(tokenData.tokenAddress), 32, 'left'),
          bigIntToArray(tokenData.tokenSubID, 32),
        ]),
      ),
    ) % SNARK_SCALAR_FIELD,
    32,
  );
}

/**
 * Validate Token Data
 *
 * @param tokenData - token data to validate
 * @returns validity
 */
function validateTokenData(tokenData: TokenData): boolean {
  if (!Object.values(TokenType).includes(tokenData.tokenType)) return false;

  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenData.tokenAddress)) return false;

  if (0n > tokenData.tokenSubID || tokenData.tokenSubID >= 2n ** 256n) return false;

  return true;
}

class Note {
  spendingKey: Uint8Array;

  viewingKey: Uint8Array;

  value: bigint;

  random: Uint8Array;

  tokenData: TokenData;

  memo: string;

  /**
   * Railgun Note
   *
   * @param spendingKey - spending private key
   * @param viewingKey - viewing key
   * @param value - note value
   * @param random - note random field
   * @param tokenData - note token data
   * @param memo - note memo
   */
  constructor(
    spendingKey: Uint8Array,
    viewingKey: Uint8Array,
    value: bigint,
    random: Uint8Array,
    tokenData: TokenData,
    memo: string,
  ) {
    // Validate bounds
    if (spendingKey.length !== 32) throw Error('Invalid spending key length');

    if (viewingKey.length !== 32) throw Error('Invalid viewing key length');

    if (value > 2n ** 128n - 1n) throw Error('Value too high');

    if (random.length !== 16) throw Error('Invalid random length');

    if (!validateTokenData(tokenData)) throw Error('Invalid token data');

    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
    this.value = value;
    this.random = random;
    this.tokenData = tokenData;
    this.memo = memo;
  }

  static fromSerializedNoteData(spendingKey: Uint8Array, viewingKey: Uint8Array, noteData: SerializedNoteData) {
    return new Note(
      spendingKey,
      viewingKey,
      arrayToBigInt(hexStringToArray(noteData.value)),
      hexStringToArray(noteData.random),
      {
        tokenType: noteData.tokenData.tokenType,
        tokenAddress: noteData.tokenData.tokenAddress,
        tokenSubID: arrayToBigInt(hexStringToArray(noteData.tokenData.tokenSubID)),
      },
      noteData.memo
    );
  }

  /**
   * Get note nullifying key
   *
   * @returns nullifying key
   */
  getNullifyingKey(): Promise<Uint8Array> {
    return hash.poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns spending public key
   */
  getSpendingPublicKey(): Promise<[Uint8Array, Uint8Array]> {
    return edBabyJubJub.privateKeyToPublicKey(this.spendingKey);
  }

  /**
   * Get note viewing public key
   *
   * @returns viewing public key
   */
  getViewingPublicKey(): Promise<Uint8Array> {
    return ed25519.privateKeyToPublicKey(this.viewingKey);
  }

  /**
   * Get note master public key
   *
   * @returns master public key
   */
  async getMasterPublicKey(): Promise<Uint8Array> {
    return hash.poseidon([...(await this.getSpendingPublicKey()), await this.getNullifyingKey()]);
  }

  /**
   * Get note public key
   *
   * @returns note public key
   */
  async getNotePublicKey(): Promise<Uint8Array> {
    return hash.poseidon([await this.getMasterPublicKey(), arrayToByteLength(this.random, 32)]);
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Uint8Array {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return hash.poseidon([
      await this.getNotePublicKey(),
      this.getTokenID(),
      bigIntToArray(this.value, 32),
    ]);
  }

  /**
   * Calculate nullifier
   *
   * @param leafIndex - leaf index of note
   * @returns nullifier
   */
  async getNullifier(leafIndex: number): Promise<Uint8Array> {
    return hash.poseidon([await this.getNullifyingKey(), bigIntToArray(BigInt(leafIndex), 32)]);
  }

  /**
   * Sign a transaction
   *
   * @param merkleRoot - transaction merkle root
   * @param boundParamsHash - transaction bound parameters hash
   * @param nullifiers - transaction nullifiers
   * @param commitmentsOut - transaction commitments
   * @returns signature
   */
  async sign(
    merkleRoot: Uint8Array,
    boundParamsHash: Uint8Array,
    nullifiers: Uint8Array[],
    commitmentsOut: Uint8Array[],
  ): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
    const sighash = await hash.poseidon([
      merkleRoot,
      boundParamsHash,
      ...nullifiers,
      ...commitmentsOut,
    ]);

    const key = this.spendingKey;

    return edBabyJubJub.signPoseidon(key, sighash);
  }

  /**
   * Gets commitment preimage
   *
   * @returns Commitment preimage
   */
  async getCommitmentPreimage(): Promise<CommitmentPreimage> {
    return {
      npk: await this.getNotePublicKey(),
      token: this.tokenData,
      value: this.value,
    };
  }

  /**
   * Encrypts random value for shield
   *
   * @returns encrypted random bundle
   */
  async encryptForShield(): Promise<ShieldRequest> {
    // Generate a random key for testing
    // In the case of shielding from regular ETH address key should be generated as hash256(eth_sign(some_fixed_message))) from the ETH address of the shielder
    // In the case of shielding from a smart contract (eg. adapt module) a random 32 byte value should be used
    const shieldPrivateKey = randomBytes(32);

    // Get shared key
    const sharedKey = ed25519.getSharedKey(shieldPrivateKey, await this.getViewingPublicKey());

    // Encrypt random
    const encryptedRandom = await aes.gcm.encrypt([this.random], sharedKey);

    // Encrypt receiver public key
    const encryptedReceiver = await aes.ctr.encrypt([await this.getViewingPublicKey()], shieldPrivateKey);

    // Construct ciphertext
    const ciphertext: ShieldCiphertext = {
      encryptedBundle: [
        encryptedRandom[0]!,
        combine([encryptedRandom[1]!, encryptedReceiver[0]!]),
        encryptedReceiver[1]!,
      ],
      shieldKey: await ed25519.privateKeyToPublicKey(shieldPrivateKey),
    };

    // Return shield request
    return {
      ciphertext,
      preimage: await this.getCommitmentPreimage(),
    };
  }

  /**
   * Generates encrypted commitment bundle
   *
   * @param senderViewingPrivateKey - sender's viewing private key
   * @param blind - blind sender from receiver
   * @returns Ciphertext
   */
  async encrypt(
    senderViewingPrivateKey: Uint8Array,
    blind: boolean,
  ): Promise<CommitmentCiphertext> {
    // For contract tests always use output type of 0
    const outputType = 0n;

    // For contract tests always use this fixed application identifier
    const applicationIdentifier = railgunBase37.encode('railgun tests');

    // Get sender public key
    const senderViewingPublicKey = await ed25519.privateKeyToPublicKey(senderViewingPrivateKey);

    // Get sender random, set to 0 is not blinding
    const senderRandom = blind ? randomBytes(15) : new Uint8Array(15);

    // Blind keys
    const blindedKeys = ed25519.railgunKeyExchange.blindKeys(
      senderViewingPublicKey,
      await this.getViewingPublicKey(),
      this.random,
      senderRandom,
    );

    // Get shared key
    const sharedKey = ed25519.getSharedKey(
      senderViewingPrivateKey,
      blindedKeys.blindedReceiverPublicKey,
    );

    // Encode memo text
    const memo = new TextEncoder().encode(this.memo);

    // Encrypt shared ciphertext
    const encryptedSharedBundle = await aes.gcm.encrypt(
      [
        await this.getMasterPublicKey(),
        combine([this.random, bigIntToArray(this.value, 16)]),
        this.getTokenID(),
        memo,
      ],
      sharedKey,
    );

    // Encrypt sender ciphertext
    const encryptedSenderBundle = await aes.ctr.encrypt(
      [combine([bigIntToArray(outputType, 1), senderRandom, applicationIdentifier])],
      senderViewingPrivateKey,
    );

    // Return formatted commitment bundle
    return {
      ciphertext: [
        encryptedSharedBundle[0]!,
        encryptedSharedBundle[1]!,
        encryptedSharedBundle[2]!,
        encryptedSharedBundle[3]!,
      ],
      blindedSenderViewingKey: blindedKeys.blindedSenderPublicKey,
      blindedReceiverViewingKey: blindedKeys.blindedReceiverPublicKey,
      annotationData: combine(encryptedSenderBundle),
      memo: encryptedSharedBundle[4]!,
    };
  }

  /**
   * Decrypts shielded note
   *
   * @param shieldKey - ephemeral key to us ein decryption
   * @param encryptedBundle - encrypted bundle to decrypt
   * @param token - token data
   * @param value - note value
   * @param viewingKey - viewing private key to try decrypting for
   * @param spendingKey - spending private key to use in decrypted note
   * @returns decrypted note or undefined if decryption failed
   */
  static async decryptShield(
    shieldKey: Uint8Array,
    encryptedBundle: [Uint8Array, Uint8Array, Uint8Array],
    token: TokenData,
    value: bigint,
    viewingKey: Uint8Array,
    spendingKey: Uint8Array,
  ): Promise<Note | undefined> {
    // Try to decrypt encrypted random
    try {
      // Get shared key
      const sharedKey = ed25519.getSharedKey(viewingKey, shieldKey);

      // Decrypt random
      const decrypted = await aes.gcm.decrypt(
        [encryptedBundle[0], encryptedBundle[1].slice(0, 16)],
        sharedKey,
      );
      const random = decrypted[0];

      // Construct note
      const note = new Note(spendingKey, viewingKey, value, random!, token, '');

      return note;
    } catch {
      return undefined;
    }
  }

  /**
   * Decrypts note from encrypted bundle
   *
   * @param encrypted - encrypted commitment bundle
   * @param viewingKey - viewing private key to try decrypting for
   * @param spendingKey - spending private key to use in decrypted note
   * @returns decrypted note or undefined if decryption failed
   */
  static async decrypt(
    encrypted: CommitmentCiphertext,
    viewingKey: Uint8Array,
    spendingKey: Uint8Array,
  ): Promise<Note | undefined> {
    // Reconstruct encrypted shared bundle
    const encryptedSharedBundle: Uint8Array[] = [...encrypted.ciphertext, encrypted.memo];

    let sharedBundle: Uint8Array[];

    // Try to decrypt encrypted shared bundle
    try {
      // Get shared key
      const sharedKey = ed25519.getSharedKey(viewingKey, encrypted.blindedSenderViewingKey);

      // Decrypt
      sharedBundle = await aes.gcm.decrypt(encryptedSharedBundle, sharedKey);
    } catch {
      return undefined;
    }

    // Decode memo
    const memo = sharedBundle.length > 3 ? new TextDecoder().decode(sharedBundle[3]) : '';

    const [_, one, two] = sharedBundle;

    if (two === undefined || one === undefined || _ === undefined) {
      return undefined;
    }

    // Decode tokenData
    const tokenData = two.length >= 96 ? {tokenType: Number(arrayToBigInt(two.slice(0, 32)).toString()), tokenAddress: arrayToHexString(two.slice(44, 64), true), tokenSubID: arrayToBigInt(two.slice(64, 96))} : {tokenType: 0, tokenAddress: arrayToHexString(two.slice(12, 32), true), tokenSubID: BigInt(0)};

    // Construct note
    const note = new Note(
      spendingKey,
      viewingKey,
      arrayToBigInt(one.slice(16, 32)),
      one.slice(0, 16),
      tokenData,
      memo.replace(/\u0000/g, ''),
    );

    return note;
  }

  serializeNoteData(): SerializedNoteData {
    return {
      value: arrayToHexString(bigIntToArray(this.value, 32), true),
      tokenData: {
        tokenType: this.tokenData.tokenType,
        tokenAddress: this.tokenData.tokenAddress,
        tokenSubID: arrayToHexString(bigIntToArray(this.tokenData.tokenSubID, 32), true),
      },
      memo: this.memo,
      random: arrayToHexString(this.random, true),
    };
  }
}

class UnshieldNote {
  unshieldAddress: string;

  value: bigint;

  tokenData: TokenData;

  /**
   * Railgun Unshield
   *
   * @param unshieldAddress - address to unshield to
   * @param value - note value
   * @param tokenData - note token data
   */
  constructor(unshieldAddress: string, value: bigint, tokenData: TokenData) {
    // Validate bounds
    if (!/^0x[a-fA-F0-9]{40}$/.test(unshieldAddress)) throw Error('Invalid unshield address');

    if (value >= 2n ** 128n) throw Error('Value too high');

    if (!validateTokenData(tokenData)) throw Error('Invalid token data');

    this.unshieldAddress = unshieldAddress;
    this.value = value;
    this.tokenData = tokenData;
  }

  /**
   * Return unshield address as npk
   *
   * @returns npk
   */
  getNotePublicKey() {
    return arrayToByteLength(hexStringToArray(this.unshieldAddress), 32);
  }

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Uint8Array {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return hash.poseidon([
      this.getNotePublicKey(),
      this.getTokenID(),
      bigIntToArray(this.value, 32),
    ]);
  }

  /**
   * Gets commitment preimage
   *
   * @returns Commitment preimage
   */
  getCommitmentPreimage(): CommitmentPreimage {
    return {
      npk: this.getNotePublicKey(),
      token: this.tokenData,
      value: this.value,
    };
  }

  /**
   * Return dummy ciphertext
   *
   * @returns Dummy ciphertext
   */
  encrypt(): CommitmentCiphertext {
    return {
      ciphertext: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)],
      blindedSenderViewingKey: new Uint8Array(32),
      blindedReceiverViewingKey: new Uint8Array(32),
      annotationData: new Uint8Array(0),
      memo: new Uint8Array(0),
    };
  }
}

class SendNote {
  masterPublicKey: bigint;

  viewingPublicKey: Uint8Array;

  value: bigint;

  random: Uint8Array;

  tokenData: TokenData;

  memo: string;

  /**
   * Railgun Note
   *
   * @param masterPublicKey - master public key
   * @param value - note value
   * @param random - note random field
   * @param tokenData - note token data
   * @param memo - note memo
   */
  constructor(
    masterPublicKey: bigint,
    viewingPublicKey: Uint8Array,
    value: bigint,
    random: Uint8Array,
    tokenData: TokenData,
    memo: string,
  ) {
    // Validate bounds
    if (masterPublicKey < 2n ** 32n) throw Error('Invalid master public key length');

    if (value > 2n ** 128n - 1n) throw Error('Value too high');

    if (random.length !== 16) throw Error('Invalid random length');

    if (!validateTokenData(tokenData)) throw Error('Invalid token data');

    this.masterPublicKey = masterPublicKey;
    this.viewingPublicKey = viewingPublicKey;
    this.value = value;
    this.random = random;
    this.tokenData = tokenData;
    this.memo = memo;
  }

  /**
   * Get note public key
   *
   * @returns note public key
   */
  async getNotePublicKey(): Promise<Uint8Array> {
    return hash.poseidon([bigIntToArray(this.masterPublicKey, 32), arrayToByteLength(this.random, 32)]);
  }

/**
   * Generates encrypted commitment bundle
   *
   * @param senderViewingPrivateKey - sender's viewing private key
   * @param blind - blind sender from receiver
   * @returns Ciphertext
   */
async encrypt(
  senderViewingPrivateKey: Uint8Array,
  blind: boolean,
): Promise<CommitmentCiphertext> {
  // For contract tests always use output type of 0
  const outputType = 0n;

  // For contract tests always use this fixed application identifier
  const applicationIdentifier = railgunBase37.encode('railgun tests');

  // Get sender public key
  const senderViewingPublicKey = await ed25519.privateKeyToPublicKey(senderViewingPrivateKey);

  // Get sender random, set to 0 is not blinding
  const senderRandom = blind ? randomBytes(15) : new Uint8Array(15);

  // Blind keys
  const blindedKeys = ed25519.railgunKeyExchange.blindKeys(
    senderViewingPublicKey,
    this.viewingPublicKey,
    this.random,
    senderRandom,
  );

  // Get shared key
  const sharedKey = ed25519.getSharedKey(
    senderViewingPrivateKey,
    blindedKeys.blindedReceiverPublicKey,
  );

  // Encode memo text
  const memo = new TextEncoder().encode(this.memo);

  // Encrypt shared ciphertext
  const encryptedSharedBundle = await aes.gcm.encrypt(
    [
      bigIntToArray(this.masterPublicKey, 32),
      combine([this.random, bigIntToArray(this.value, 16)]),
      this.getTokenID(),
      memo,
    ],
    sharedKey,
  );

  // Encrypt sender ciphertext
  const encryptedSenderBundle = await aes.ctr.encrypt(
    [combine([bigIntToArray(outputType, 1), senderRandom, applicationIdentifier])],
    senderViewingPrivateKey,
  );

  // Return formatted commitment bundle
  return {
    ciphertext: [
      encryptedSharedBundle[0]!,
      encryptedSharedBundle[1]!,
      encryptedSharedBundle[2]!,
      encryptedSharedBundle[3]!,
    ],
    blindedSenderViewingKey: blindedKeys.blindedSenderPublicKey,
    blindedReceiverViewingKey: blindedKeys.blindedReceiverPublicKey,
    annotationData: combine(encryptedSenderBundle),
    memo: encryptedSharedBundle[4]!,
  };
}

  /**
   * Gets token ID from token data
   *
   * @returns token ID
   */
  getTokenID(): Uint8Array {
    return getTokenID(this.tokenData);
  }

  /**
   * Get note hash
   *
   * @returns hash
   */
  async getHash(): Promise<Uint8Array> {
    return hash.poseidon([
      await this.getNotePublicKey(),
      this.getTokenID(),
      bigIntToArray(this.value, 32),
    ]);
  }

  /**
   * Gets commitment preimage
   *
   * @returns Commitment preimage
   */
  async getCommitmentPreimage(): Promise<CommitmentPreimage> {
    return {
      npk: await this.getNotePublicKey(),
      token: this.tokenData,
      value: this.value,
    };
  }
}

export { getTokenID, validateTokenData, Note, UnshieldNote, SendNote };
