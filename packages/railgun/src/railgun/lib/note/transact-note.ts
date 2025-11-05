import { poseidon } from "../utils/poseidon";
import {
  AddressData,
  decodeAddress,
  encodeAddress,
} from "../key-derivation/bech32";
import {
  Ciphertext,
  CiphertextXChaCha,
  LegacyNoteSerialized,
  NFTTokenData,
  NoteSerialized,
  OutputType,
  TokenData,
  TokenType,
} from "../models/formatted-types";
import { MEMO_SENDER_RANDOM_NULL } from "../models/transaction-constants";
import { TokenDataGetter } from "../token/token-data-getter";
import { ByteLength, ByteUtils } from "../utils/bytes";
import {
  ciphertextToEncryptedRandomData,
  encryptedDataToCiphertext,
} from "../utils/encryption/ciphertext";
import { AES } from "../utils/encryption/aes";
import { unblindNoteKey } from "../utils/keys-utils";
import { unblindNoteKeyLegacy } from "../utils/keys-utils-legacy";
import { Memo } from "./memo";
import {
  assertValidNoteRandom,
  getTokenDataERC20,
  getTokenDataHash,
  ERC721_NOTE_VALUE,
  serializeTokenData,
} from "./note-util";
import { isDefined } from "../utils/is-defined";
import { WalletInfo } from "../wallet/wallet-info";
import { TXIDVersion } from "../models/poi-types";
import { Chain } from "../models/engine-types";
import { XChaCha20 } from "../utils/encryption/x-cha-cha-20";

/**
 *
 * A Note on Encoded MPKs:
 *
 * The presence of senderRandom field, or an encoded/unencoded MPK in a decrypted note,
 * tells us whether or not the sender address was hidden or visible.
 *
 *          MPK               senderRandom                                Sender address
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 * Value    Unencoded         Random hex (15)                             Hidden
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 * Value    Encoded           undefined or MEMO_SENDER_RANDOM_NULL        Visible
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 */

export class TransactNote {
  // address data of recipient
  readonly receiverAddressData: AddressData;

  // address data of sender
  readonly senderAddressData: Optional<AddressData>;

  // 32 byte hash of token data
  readonly tokenHash: string;

  readonly tokenData: TokenData;

  // 16 byte random
  readonly random: string;

  // value to transfer as bigint
  readonly value: bigint;

  readonly notePublicKey: bigint;

  readonly hash: bigint;

  readonly outputType: Optional<OutputType>;

  readonly walletSource: Optional<string>;

  readonly senderRandom: Optional<string>;

  readonly memoText: Optional<string>;

  // Only used during serialization/storage of ShieldCommitments.
  readonly shieldFee: Optional<string>;

  readonly blockNumber: Optional<number>;

  /**
   * Create Note object from values
   * @param {BigInt} receiverAddressData - recipient wallet address data
   * @param {string} random - note randomness
   * @param {string} tokenData - note token ID
   * @param {BigInt} value - note value
   */
  private constructor(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    random: string,
    value: bigint,
    tokenData: TokenData,
    outputType: Optional<OutputType>,
    walletSource: Optional<string>,
    senderRandom: Optional<string>,
    memoText: Optional<string>,
    shieldFee: Optional<string>,
    blockNumber: Optional<number>
  ) {
    assertValidNoteRandom(random);

    this.receiverAddressData = receiverAddressData;
    this.senderAddressData = senderAddressData;

    this.random = random;
    this.value = BigInt(value);
    this.tokenData = serializeTokenData(
      tokenData.tokenAddress,
      tokenData.tokenType,
      tokenData.tokenSubID
    );
    this.tokenHash = getTokenDataHash(tokenData);
    this.notePublicKey = this.getNotePublicKey();
    this.hash = TransactNote.getHash(
      this.notePublicKey,
      this.tokenHash,
      this.value
    );
    this.outputType = outputType;
    this.walletSource = walletSource;
    this.senderRandom = senderRandom;
    this.memoText = memoText;
    this.shieldFee = shieldFee;
    this.blockNumber = blockNumber;
  }

  static createTransfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    value: bigint,
    tokenData: TokenData,
    showSenderAddressToRecipient: boolean,
    outputType: OutputType,
    memoText: Optional<string>
  ): TransactNote {
    // See note at top of file.
    const shouldCreateSenderRandom = !showSenderAddressToRecipient;
    const senderRandom = shouldCreateSenderRandom
      ? TransactNote.getSenderRandom()
      : MEMO_SENDER_RANDOM_NULL;

    const { walletSource } = WalletInfo;

    return new TransactNote(
      receiverAddressData,
      senderAddressData,
      TransactNote.getNoteRandom(),
      value,
      tokenData,
      outputType,
      walletSource,
      senderRandom,
      memoText,
      undefined, // shieldFee
      undefined // blockNumber
    );
  }

  static createERC721Transfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    tokenData: NFTTokenData,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>
  ): TransactNote {
    if (tokenData.tokenType !== TokenType.ERC721) {
      throw new Error(
        `Invalid token type for ERC721 transfer: ${tokenData.tokenType}`
      );
    }

    return TransactNote.createTransfer(
      receiverAddressData,
      senderAddressData,
      ERC721_NOTE_VALUE,
      tokenData,
      showSenderAddressToRecipient,
      OutputType.Transfer,
      memoText
    );
  }

  static createERC1155Transfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    tokenData: NFTTokenData,
    amount: bigint,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>
  ): TransactNote {
    if (tokenData.tokenType !== TokenType.ERC1155) {
      throw new Error(
        `Invalid token type for ERC1155 transfer: ${tokenData.tokenType}`
      );
    }

    return TransactNote.createTransfer(
      receiverAddressData,
      senderAddressData,
      amount,
      tokenData,
      showSenderAddressToRecipient,
      OutputType.Transfer,
      memoText
    );
  }

  static getNoteRandom(): string {
    return ByteUtils.randomHex(16);
  }

  static getSenderRandom(): string {
    return ByteUtils.randomHex(15);
  }

  private getNotePublicKey(): bigint {
    return poseidon([
      this.receiverAddressData.masterPublicKey,
      ByteUtils.hexToBigInt(this.random),
    ]);
  }

  getSenderAddress(): Optional<string> {
    if (!this.senderAddressData) {
      return undefined;
    }

    return encodeAddress(this.senderAddressData);
  }

  /**
   * Get note hash
   * @returns {bigint} hash
   */
  static getHash(
    notePublicKey: bigint,
    tokenHash: string,
    value: bigint
  ): bigint {
    return poseidon([notePublicKey, ByteUtils.hexToBigInt(tokenHash), value]);
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encryptV2(
    txidVersion: TXIDVersion,
    sharedKey: Uint8Array,
    senderMasterPublicKey: bigint,
    senderRandom: Optional<string>,
    viewingPrivateKey: Uint8Array
  ): {
    noteCiphertext: Ciphertext;
    noteMemo: string;
    annotationData: string;
  } {
    if (txidVersion !== TXIDVersion.V2_PoseidonMerkle) {
      throw new Error("Invalid txidVersion for V2 encryption");
    }

    const prefix = false;
    const { tokenHash, value, random } = this.formatFields(prefix);

    const receiverMasterPublicKey = this.receiverAddressData.masterPublicKey;

    // Encode the master public key only if the senderRandom is unset (sender wants address to be visible by receiver).
    const encodedMasterPublicKey = TransactNote.getEncodedMasterPublicKey(
      senderRandom,
      receiverMasterPublicKey,
      senderMasterPublicKey
    );

    const encodedMemoText = Memo.encodeMemoText(this.memoText);
    const ciphertext = AES.encryptGCM(
      [
        ByteUtils.nToHex(encodedMasterPublicKey, ByteLength.UINT_256),
        tokenHash,
        `${random}${value}`,
        encodedMemoText,
      ],
      sharedKey
    );

    if (!isDefined(this.outputType)) {
      throw new Error(
        "Output type must be set for encrypted note annotation data"
      );
    }

    if (!isDefined(this.senderRandom)) {
      throw new Error(
        "Sender random must be set for encrypted note annotation data"
      );
    }

    if (!isDefined(this.walletSource)) {
      throw new Error(
        "Wallet source must be set for encrypted note annotation data"
      );
    }

    const annotationData = Memo.createEncryptedNoteAnnotationDataV2(
      this.outputType,
      this.senderRandom,
      this.walletSource,
      viewingPrivateKey
    );

    return {
      noteCiphertext: {
        ...ciphertext,
        data: ciphertext.data.slice(0, 3), // Remove encrypted memo text.
      },
      noteMemo: ciphertext.data[3],
      annotationData,
    };
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encryptV3(
    txidVersion: TXIDVersion,
    sharedKey: Uint8Array,
    senderMasterPublicKey: bigint
  ): CiphertextXChaCha {
    if (txidVersion !== TXIDVersion.V3_PoseidonMerkle) {
      throw new Error("Invalid txidVersion for V3 encryption");
    }

    const prefix = false;
    const { tokenHash, value, random } = this.formatFields(prefix);

    const receiverMasterPublicKey = this.receiverAddressData.masterPublicKey;

    // Encode the master public key only if the senderRandom is unset (sender wants address to be visible by receiver).
    const encodedMasterPublicKey = TransactNote.getEncodedMasterPublicKey(
      this.senderRandom,
      receiverMasterPublicKey,
      senderMasterPublicKey
    );

    if (!isDefined(this.senderRandom)) {
      throw new Error(
        "Sender random must be set for V3 encrypted note annotation data"
      );
    }

    if (this.senderRandom.length !== 30) {
      throw new Error(
        "Invalid senderRandom length - expected 15 bytes (30 length)"
      );
    }

    const encodedMemoText = Memo.encodeMemoText(this.memoText);

    const plaintext = [
      ByteUtils.nToHex(encodedMasterPublicKey, ByteLength.UINT_256), // 64 length
      `${random}${value}`, // 64 length
      tokenHash, // 64 length
      this.senderRandom, // 30 length
      encodedMemoText, // variable length
    ].join("");

    return XChaCha20.encryptChaCha20Poly1305(plaintext, sharedKey);
  }

  private static unblindViewingPublicKey(
    random: string,
    blindedViewingPublicKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isLegacyDecryption: boolean
  ): Uint8Array {
    if (blindedViewingPublicKey && isDefined(senderRandom)) {
      const unblinded = isLegacyDecryption
        ? unblindNoteKeyLegacy(blindedViewingPublicKey, random, senderRandom)
        : unblindNoteKey(blindedViewingPublicKey, random, senderRandom);

      if (unblinded) {
        return unblinded;
      }
    }

    return new Uint8Array(); // dummy
  }

  /**
   * AES-256-GCM decrypts note data (V2)
   */
  static async decrypt(
    txidVersion: TXIDVersion,
    chain: Chain,
    currentWalletAddressData: AddressData,
    noteCiphertext: Ciphertext | CiphertextXChaCha,
    sharedKey: Uint8Array,
    memoV2: string,
    annotationData: string,
    viewingPrivateKey: Uint8Array,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    tokenDataGetter: TokenDataGetter,
    blockNumber: Optional<number>,
    transactCommitmentBatchIndexV3: Optional<number>
  ): Promise<TransactNote> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        if (!("tag" in noteCiphertext)) {
          throw new Error("Invalid ciphertext for V2 decryption");
        }

        const ciphertextDataWithMemoText = [
          ...noteCiphertext.data,
          ByteUtils.strip0x(memoV2),
        ];
        const fullCiphertext: Ciphertext = {
          ...noteCiphertext,
          data: ciphertextDataWithMemoText,
        };
        const decryptedCiphertext = AES.decryptGCM(
          fullCiphertext,
          sharedKey
        ).map((value) => ByteUtils.hexlify(value));

        const { random, value, memoText, tokenData, encodedMPK } =
          await this.getDecryptedValuesNoteCiphertextV2(
            txidVersion,
            chain,
            decryptedCiphertext,
            tokenDataGetter
          );

        const noteAnnotationData = isSentNote
          ? Memo.decryptNoteAnnotationData(annotationData, viewingPrivateKey)
          : undefined;

        return this.noteFromDecryptedValues(
          currentWalletAddressData,
          noteAnnotationData?.outputType,
          noteAnnotationData?.walletSource,
          blindedReceiverViewingKey,
          blindedSenderViewingKey,
          noteAnnotationData?.senderRandom,
          isSentNote,
          isLegacyDecryption,
          blockNumber,
          random,
          value,
          memoText,
          tokenData,
          encodedMPK
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        if ("tag" in noteCiphertext) {
          throw new Error("Invalid ciphertext for V3 decryption");
        }

        const decryptedCiphertext = XChaCha20.decryptChaCha20Poly1305(
          noteCiphertext,
          sharedKey
        );

        const { random, value, memoText, tokenData, encodedMPK, senderRandom } =
          await this.getDecryptedValuesNoteCiphertextV3(
            txidVersion,
            chain,
            decryptedCiphertext,
            tokenDataGetter
          );

        if (!isDefined(transactCommitmentBatchIndexV3)) {
          throw new Error(
            "transactCommitmentBatchIndex must be defined for V3 decryption"
          );
        }

        const senderCiphertext = annotationData;

        const senderCiphertextDecrypted = isSentNote
          ? Memo.decryptSenderCiphertextV3(
              senderCiphertext,
              viewingPrivateKey,
              transactCommitmentBatchIndexV3
            )
          : undefined;

        return this.noteFromDecryptedValues(
          currentWalletAddressData,
          senderCiphertextDecrypted?.outputType,
          senderCiphertextDecrypted?.walletSource,
          blindedReceiverViewingKey,
          blindedSenderViewingKey,
          senderRandom,
          isSentNote,
          isLegacyDecryption,
          blockNumber,
          random,
          value,
          memoText,
          tokenData,
          encodedMPK
        );
      }
    }

    throw new Error("Invalid txidVersion for note decryption");
  }

  static getDecodedMasterPublicKey(
    currentWalletMasterPublicKey: bigint,
    encodedMasterPublicKey: bigint,
    senderRandom: Optional<string>,
    isLegacyDecryption: boolean
  ): bigint {
    if (
      isLegacyDecryption ||
      (isDefined(senderRandom) && senderRandom !== MEMO_SENDER_RANDOM_NULL)
    ) {
      return encodedMasterPublicKey; // Unencoded
    }

    return encodedMasterPublicKey ^ currentWalletMasterPublicKey;
  }

  static getEncodedMasterPublicKey(
    senderRandom: Optional<string>,
    receiverMasterPublicKey: bigint,
    senderMasterPublicKey: bigint
  ): bigint {
    return isDefined(senderRandom) && senderRandom !== MEMO_SENDER_RANDOM_NULL
      ? receiverMasterPublicKey // Unencoded
      : receiverMasterPublicKey ^ senderMasterPublicKey;
  }

  private static async getDecryptedValuesNoteCiphertextV2(
    txidVersion: TXIDVersion,
    chain: Chain,
    decryptedCiphertext: string[],
    tokenDataGetter: TokenDataGetter
  ): Promise<{
    random: string;
    value: bigint;
    memoText: Optional<string>;
    tokenData: TokenData;
    encodedMPK: bigint;
  }> {
    // Decrypted Values (V2):
    // 0: Master Public Key (Encoded)
    // 1: Token Address
    // 2: Value
    // 3 (+ more array values for legacy): Optional Memo string

    const random = decryptedCiphertext[2].substring(0, 32);
    const value = ByteUtils.hexToBigInt(
      decryptedCiphertext[2].substring(32, 64)
    );
    const tokenHash = decryptedCiphertext[1];
    const memoText = Memo.decodeMemoText(
      ByteUtils.combine(decryptedCiphertext.slice(3))
    );

    const tokenData = await tokenDataGetter.getTokenDataFromHash(
      txidVersion,
      chain,
      tokenHash
    );

    const encodedMPK = ByteUtils.hexToBigInt(decryptedCiphertext[0]);

    return { random, value, memoText, tokenData, encodedMPK };
  }

  private static async getDecryptedValuesNoteCiphertextV3(
    txidVersion: TXIDVersion,
    chain: Chain,
    decryptedCiphertextV3: string,
    tokenDataGetter: TokenDataGetter
  ): Promise<{
    random: string;
    value: bigint;
    memoText: Optional<string>;
    tokenData: TokenData;
    encodedMPK: bigint;
    senderRandom: string;
  }> {
    // Decrypted Values (V3):

    // - encodedMPK (senderMPK XOR receiverMPK - 32 bytes)
    const encodedMPK = ByteUtils.hexToBigInt(
      decryptedCiphertextV3.substring(0, 64)
    );

    // - random & amount (16 bytes each)
    const random = decryptedCiphertextV3.substring(64, 96);
    const value = ByteUtils.hexToBigInt(
      decryptedCiphertextV3.substring(96, 128)
    );

    // - token (32 bytes)
    const tokenHash = decryptedCiphertextV3.substring(128, 192);
    const tokenData = await tokenDataGetter.getTokenDataFromHash(
      txidVersion,
      chain,
      tokenHash
    );

    // - senderRandom (15 bytes)
    const senderRandom = decryptedCiphertextV3.substring(192, 222); // Note: 30 length for 15 bytes

    // - memo (variable bytes)
    const memoText =
      decryptedCiphertextV3.length > 222
        ? Memo.decodeMemoText(decryptedCiphertextV3.substring(222))
        : undefined;

    return { random, value, memoText, tokenData, encodedMPK, senderRandom };
  }

  private static async noteFromDecryptedValues(
    currentWalletAddressData: AddressData,
    outputType: Optional<OutputType>,
    walletSource: Optional<string>,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    blockNumber: Optional<number>,
    random: string,
    value: bigint,
    memoText: Optional<string>,
    tokenData: TokenData,
    encodedMPK: bigint
  ) {
    if (isSentNote) {
      // SENT note.
      const receiverAddressData: AddressData = {
        masterPublicKey: TransactNote.getDecodedMasterPublicKey(
          currentWalletAddressData.masterPublicKey,
          encodedMPK,
          senderRandom,
          isLegacyDecryption
        ),
        viewingPublicKey: TransactNote.unblindViewingPublicKey(
          random,
          blindedReceiverViewingKey,
          senderRandom,
          isLegacyDecryption
        ),
      };

      return new TransactNote(
        receiverAddressData,
        currentWalletAddressData,
        random,
        value,
        tokenData,
        outputType,
        walletSource,
        senderRandom,
        memoText,
        undefined, // shieldFee
        blockNumber
      );
    }

    // RECEIVE note.
    // Master public key will be encoded (different) if the sender wants address to be visible by receiver.

    const senderAddressVisible =
      encodedMPK !== currentWalletAddressData.masterPublicKey;

    const senderAddressData: Optional<AddressData> = senderAddressVisible
      ? {
          masterPublicKey: TransactNote.getDecodedMasterPublicKey(
            currentWalletAddressData.masterPublicKey,
            encodedMPK,
            undefined, // Sender is not blinded, null senderRandom.
            isLegacyDecryption
          ),
          viewingPublicKey: TransactNote.unblindViewingPublicKey(
            random,
            blindedSenderViewingKey,
            MEMO_SENDER_RANDOM_NULL, // Sender is not blinded, null senderRandom.
            isLegacyDecryption
          ),
        }
      : undefined;

    return new TransactNote(
      currentWalletAddressData,
      senderAddressData,
      random,
      value,
      tokenData,
      outputType,
      walletSource,
      senderRandom,
      memoText,
      undefined, // shieldFee
      blockNumber
    );
  }

  private formatFields(prefix: boolean = false) {
    return {
      npk: ByteUtils.nToHex(this.notePublicKey, ByteLength.UINT_256, prefix),
      tokenHash: ByteUtils.formatToByteLength(
        this.tokenHash,
        ByteLength.UINT_256,
        prefix
      ),
      value: ByteUtils.nToHex(BigInt(this.value), ByteLength.UINT_128, prefix),
      random: ByteUtils.formatToByteLength(
        this.random,
        ByteLength.UINT_128,
        prefix
      ),
      senderRandom: this.senderRandom ?? undefined,
      walletSource: this.walletSource ?? undefined,
      outputType: this.outputType ?? undefined,
      shieldFee: this.shieldFee ?? undefined,
    };
  }

  /**
   * Gets JSON serialized version of note
   * @returns serialized note
   */
  serialize(prefix?: boolean): NoteSerialized {
    const {
      npk,
      tokenHash,
      value,
      random,
      walletSource,
      senderRandom,
      outputType,
      shieldFee,
    } = this.formatFields(prefix);

    return {
      npk,
      tokenHash,
      value,
      random,
      walletSource,
      senderRandom,
      outputType,
      recipientAddress: encodeAddress(this.receiverAddressData),
      senderAddress: this.senderAddressData
        ? encodeAddress(this.senderAddressData)
        : undefined,
      memoText: this.memoText,
      shieldFee,
      blockNumber: this.blockNumber,
    };
  }

  serializeLegacy(
    viewingPrivateKey: Uint8Array,
    prefix?: boolean
  ): LegacyNoteSerialized {
    const { npk, tokenHash, value, random } = this.formatFields(prefix);
    const memoField: string[] = [];
    const randomCiphertext = AES.encryptGCM([random], viewingPrivateKey);
    const [ivTag, data] = ciphertextToEncryptedRandomData(randomCiphertext);

    return {
      npk,
      tokenHash,
      value,
      encryptedRandom: [ivTag, data].map((v) =>
        ByteUtils.hexlify(v, prefix)
      ) as [string, string],
      memoField,
      recipientAddress: encodeAddress(this.receiverAddressData),
      memoText: this.memoText,
      blockNumber: this.blockNumber,
    };
  }

  static isLegacyTransactNote(
    noteData: NoteSerialized | LegacyNoteSerialized
  ): boolean {
    return "encryptedRandom" in noteData;
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @param viewingPrivateKey - viewing private key for decryption
   * @returns TransactNote
   */
  static async deserialize(
    txidVersion: TXIDVersion,
    chain: Chain,
    noteData: NoteSerialized | LegacyNoteSerialized,
    viewingPrivateKey: Uint8Array,
    tokenDataGetter: TokenDataGetter
  ): Promise<TransactNote> {
    if ("encryptedRandom" in noteData) {
      // LegacyNoteSerialized type.
      return TransactNote.deserializeLegacy(noteData, viewingPrivateKey);
    }

    const { tokenHash } = noteData;
    const tokenData = await tokenDataGetter.getTokenDataFromHash(
      txidVersion,
      chain,
      tokenHash
    );

    // NoteSerialized type.
    return new TransactNote(
      decodeAddress(noteData.recipientAddress),
      isDefined(noteData.senderAddress)
        ? decodeAddress(noteData.senderAddress)
        : undefined,
      noteData.random,
      ByteUtils.hexToBigInt(noteData.value),
      tokenData,
      noteData.outputType ?? undefined,
      noteData.walletSource ?? undefined,
      noteData.senderRandom ?? undefined,
      noteData.memoText ?? undefined,
      noteData.shieldFee ?? undefined,
      noteData.blockNumber ?? undefined
    );
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @param viewingPrivateKey - viewing private key for decryption
   * @returns TransactNote
   */
  private static deserializeLegacy(
    noteData: LegacyNoteSerialized,
    viewingPrivateKey: Uint8Array
  ): TransactNote {
    const randomCiphertext = encryptedDataToCiphertext(
      noteData.encryptedRandom
    );
    const decryptedRandom = AES.decryptGCM(randomCiphertext, viewingPrivateKey);

    // Legacy can only be erc20.
    const { tokenHash } = noteData;
    const tokenData = getTokenDataERC20(tokenHash);

    return new TransactNote(
      decodeAddress(noteData.recipientAddress),
      undefined, // senderAddress
      ByteUtils.combine(decryptedRandom),
      ByteUtils.hexToBigInt(noteData.value),
      tokenData,
      undefined, // outputType
      undefined, // walletSource
      undefined, // senderRandom
      noteData.memoText ?? undefined,
      undefined, // shieldFee
      noteData.blockNumber ?? undefined
    );
  }

  /**
   * Calculates nullifier for a given note
   * @param nullifyingKey - nullifying key
   * @param leafIndex - Index of note's commitment in the Merkle tree
   * @returns nullifier (hex string)
   */
  static getNullifier(nullifyingKey: bigint, leafIndex: number): bigint {
    return poseidon([nullifyingKey, BigInt(leafIndex)]);
  }

  newProcessingNoteWithValue(value: bigint): TransactNote {
    return new TransactNote(
      this.receiverAddressData,
      this.senderAddressData,
      TransactNote.getNoteRandom(),
      value,
      this.tokenData,
      this.outputType,
      this.walletSource,
      this.senderRandom,
      this.memoText,
      this.shieldFee,
      undefined // blockNumber
    );
  }

  static calculateTotalNoteValues = (notes: TransactNote[]): bigint =>
    notes.reduce((left, right) => left + right.value, BigInt(0));

  /**
   * TransactNote with tokenData and value, for a mimic Unshield Note during solution processing.
   * All other fields are placeholders.
   */
  static createNullUnshieldNote(
    tokenData: TokenData,
    value: bigint
  ): TransactNote {
    const nullAddressData: AddressData = {
      masterPublicKey: 0n,
      viewingPublicKey: ByteUtils.nToBytes(0n, ByteLength.UINT_256),
    };

    return new TransactNote(
      nullAddressData,
      undefined, // senderAddressData
      TransactNote.getNoteRandom(),
      value,
      tokenData,
      undefined, // outputType
      undefined, // walletSource
      undefined, // senderRandom
      undefined, // memoText
      undefined, // shieldFee
      undefined // blockNumber
    );
  }
}
