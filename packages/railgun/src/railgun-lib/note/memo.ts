import { EngineDebug } from '../debugger/debugger';
import {
  CiphertextCTR,
  CiphertextXChaCha,
  EncryptedNoteAnnotationData,
  NoteAnnotationData,
  OutputType,
  SenderAnnotationDecrypted,
  XChaChaEncryptionAlgorithm,
} from '../models/formatted-types';
import { MEMO_SENDER_RANDOM_NULL } from '../models/transaction-constants';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { AES } from '../utils/encryption/aes';
import { XChaCha20 } from '../utils/encryption/x-cha-cha-20';
import { isDefined } from '../utils/is-defined';
import { isReactNative } from '../utils/runtime';
import { WalletInfo } from '../wallet/wallet-info';

// TextEncoder/TextDecoder (used in this file) needs to shimmed in React Native
if (isReactNative) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('fast-text-encoding');
}

// Annotation Data used to be stored as the leading bytes in Memo field.
export const LEGACY_MEMO_METADATA_BYTE_CHUNKS = 2;

export class Memo {
  static async decryptNoteAnnotationData(
    annotationData: string,
    viewingPrivateKey: Uint8Array,
  ): Promise<Optional<NoteAnnotationData>> {
    if (!annotationData || !annotationData.length) {
      return undefined;
    }

    try {
      // Remove 0x prefix.
      const hexlified = ByteUtils.hexlify(annotationData);

      const hasTwoBytes = hexlified.length > 64;

      const metadataCiphertext = {
        iv: hexlified.substring(0, 32),
        data: hasTwoBytes
          ? [hexlified.substring(32, 64), hexlified.substring(64, 96), hexlified.substring(96, 128)]
          : [hexlified.substring(32, 64)],
      };
      const decrypted = await AES.decryptCTR(metadataCiphertext, viewingPrivateKey);

      const walletSource: Optional<string> = hasTwoBytes
        ? this.decodeWalletSource(decrypted[2])
        : undefined;

      const noteAnnotationData: NoteAnnotationData = {
        outputType: parseInt(decrypted[0].substring(0, 2), 16),
        senderRandom: decrypted[0].substring(2, 32),
        walletSource,
      };

      if (!Object.values(OutputType).includes(noteAnnotationData.outputType)) {
        throw new Error('Error decrypting note annotation data.');
      }

      return noteAnnotationData;
    } catch (cause) {
      EngineDebug.error(new Error('Failed to decrypt node annotation data', { cause }));
      return undefined;
    }
  }

  static decryptSenderCiphertextV3(
    senderCiphertext: string,
    viewingPrivateKey: Uint8Array,
    transactCommitmentBatchIndex: number,
  ): Optional<SenderAnnotationDecrypted> {
    if (!senderCiphertext || !senderCiphertext.length) {
      return undefined;
    }

    try {
      const strippedSenderCiphertext = ByteUtils.strip0x(senderCiphertext);

      const metadataCiphertext: CiphertextXChaCha = {
        algorithm: XChaChaEncryptionAlgorithm.XChaCha,
        nonce: strippedSenderCiphertext.substring(0, 32),
        bundle: strippedSenderCiphertext.substring(32),
      };
      const decrypted = XChaCha20.decryptChaCha20(metadataCiphertext, viewingPrivateKey);

      const walletSource: Optional<string> = this.decodeWalletSource(decrypted.substring(0, 32));

      const outputTypeByteOffset = 32 + transactCommitmentBatchIndex * 2;

      const outputType = parseInt(
        decrypted.substring(outputTypeByteOffset, outputTypeByteOffset + 2),
        16,
      );
      if (Number.isNaN(outputType)) {
        throw new Error('Invalid outputType for senderCiphertextData');
      }

      const senderAnnotation: SenderAnnotationDecrypted = {
        walletSource,
        outputType,
      };
      return senderAnnotation;
    } catch (cause) {
      EngineDebug.error(new Error('Failed to decrypt sender ciphertext V3', { cause }));
      return undefined;
    }
  }

  static decryptSenderRandom = async (annotationData: string, viewingPrivateKey: Uint8Array): Promise<string> => {
    const noteAnnotationData = await Memo.decryptNoteAnnotationData(annotationData, viewingPrivateKey);
    return noteAnnotationData ? noteAnnotationData.senderRandom : MEMO_SENDER_RANDOM_NULL;
  };

  // static decryptSenderRandomV3 = (
  //   senderCiphertext: string,
  //   viewingPrivateKey: Uint8Array,
  //   transactCommitmentBatchIndex: number,
  // ): string => {
  //   const noteAnnotationData = Memo.decryptSenderCiphertextV3(
  //     senderCiphertext,
  //     viewingPrivateKey,
  //     transactCommitmentBatchIndex,
  //   );
  //   return noteAnnotationData ? noteAnnotationData.senderRandom : MEMO_SENDER_RANDOM_NULL;
  // };

  private static decodeWalletSource(decryptedBytes: string): Optional<string> {
    try {
      const decoded = WalletInfo.decodeWalletSource(decryptedBytes);
      return decoded;
    } catch (err) {
      console.error(err);
      return undefined;
    }
  }

  static async createEncryptedNoteAnnotationDataV2(
    outputType: OutputType,
    senderRandom: string,
    walletSource: string,
    viewingPrivateKey: Uint8Array,
  ): Promise<EncryptedNoteAnnotationData> {
    const outputTypeFormatted = ByteUtils.nToHex(BigInt(outputType), ByteLength.UINT_8); // 1 byte
    const senderRandomFormatted = senderRandom; // 15 bytes
    const metadataField0: string = `${outputTypeFormatted}${senderRandomFormatted}`;
    if (metadataField0.length !== 32) {
      throw new Error('Metadata field 0 must be 16 bytes.');
    }

    const metadataField1 = new Array<string>(30).fill('0').join(''); // 32 zeroes

    let metadataField2 = WalletInfo.getEncodedWalletSource(walletSource);
    while (metadataField2.length < 30) {
      metadataField2 = `0${metadataField2}`;
    }

    const toEncrypt = [metadataField0, metadataField1, metadataField2];

    const metadataCiphertext: CiphertextCTR = await AES.encryptCTR(toEncrypt, viewingPrivateKey);

    return (
      metadataCiphertext.iv + // ciphertext IV
      metadataCiphertext.data[0] + // outputType/senderRandom
      metadataCiphertext.data[1] + // 32 zeroes
      metadataCiphertext.data[2] // Wallet source, prepended with 0s
    );
  }

  static createSenderAnnotationEncryptedV3(
    walletSource: string,
    orderedOutputTypes: OutputType[],
    viewingPrivateKey: Uint8Array,
  ): EncryptedNoteAnnotationData {
    let metadataField0 = WalletInfo.getEncodedWalletSource(walletSource);
    while (metadataField0.length < 32) {
      metadataField0 = `0${metadataField0}`;
    }

    const outputTypesFormatted = orderedOutputTypes.map((outputType) =>
      // 1 byte each
      ByteUtils.nToHex(BigInt(outputType), ByteLength.UINT_8),
    );
    const metadataField1 = outputTypesFormatted.join('');

    const toEncrypt = `${metadataField0}${metadataField1}`;

    const metadataCiphertext: CiphertextXChaCha = XChaCha20.encryptChaCha20(
      toEncrypt,
      viewingPrivateKey,
    );

    return ByteUtils.prefix0x(metadataCiphertext.nonce + metadataCiphertext.bundle);
  }

  static encodeMemoText(memoText: Optional<string>): string {
    if (!isDefined(memoText)) {
      return '';
    }
    const encoded = ByteUtils.hexlify(new TextEncoder().encode(memoText));
    return encoded;
  }

  static decodeMemoText(encoded: string): Optional<string> {
    if (!encoded.length) {
      return undefined;
    }
    return new TextDecoder().decode(ByteUtils.fastHexToBytes(encoded));
  }
}
