import { Interface } from 'ethers';
import {
  CommitmentCiphertextV2,
  CommitmentType,
  Nullifier,
  ShieldCommitment,
  TransactCommitmentV2,
} from '../../../models/formatted-types';
import { ByteLength, ByteUtils } from '../../../utils/bytes';
import { EngineDebug } from '../../../debugger/debugger';
import {
  CommitmentEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsUnshieldListener,
  UnshieldStoredEvent,
} from '../../../models/event-types';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  NullifiedEvent,
  ShieldCiphertextStructOutput,
  ShieldEvent,
  TransactEvent,
  UnshieldEvent,
} from '../../../abi/typechain/RailgunSmartWallet';
import { serializeTokenData, serializePreImage, getNoteHash } from '../../../note/note-util';
import { ShieldEvent as ShieldEvent_LegacyShield_PreMar23 } from '../../../abi/typechain/RailgunSmartWallet_Legacy_PreMar23';
import { ABIRailgunSmartWallet_Legacy_PreMar23 } from '../../../abi/abi';
import { TXIDVersion } from '../../../models/poi-types';

export class V2Events {
  private static formatShieldCommitments(
    transactionHash: string,
    preImages: CommitmentPreimageStructOutput[],
    shieldCiphertext: ShieldCiphertextStructOutput[],
    blockNumber: number,
    utxoTree: number,
    utxoStartingIndex: number,
    fees: Optional<bigint[]>,
    timestamp: Optional<number>,
  ): ShieldCommitment[] {
    const shieldCommitments = preImages.map((commitmentPreImage, index) => {
      const npk = ByteUtils.formatToByteLength(commitmentPreImage.npk, ByteLength.UINT_256);
      const tokenData = serializeTokenData(
        commitmentPreImage.token.tokenAddress,
        commitmentPreImage.token.tokenType,
        commitmentPreImage.token.tokenSubID.toString(),
      );
      const { value } = commitmentPreImage;
      const preImage = serializePreImage(npk, tokenData, value);
      const noteHash = getNoteHash(npk, tokenData, value);

      const commitment: ShieldCommitment = {
        commitmentType: CommitmentType.ShieldCommitment,
        hash: ByteUtils.nToHex(noteHash, ByteLength.UINT_256),
        txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
        timestamp,
        blockNumber,
        preImage,
        encryptedBundle: shieldCiphertext[index].encryptedBundle,
        shieldKey: shieldCiphertext[index].shieldKey,
        fee: fees && fees[index] ? fees[index].toString() : undefined,
        utxoTree,
        utxoIndex: utxoStartingIndex + index,
        from: undefined,
      };
      return commitment;
    });
    return shieldCommitments;
  }

  static formatShieldEvent(
    shieldEventArgs: ShieldEvent.OutputObject | ShieldEvent_LegacyShield_PreMar23.OutputObject,
    transactionHash: string,
    blockNumber: number,
    fees: Optional<bigint[]>,
    timestamp: Optional<number>,
  ): CommitmentEvent {
    const { treeNumber, startPosition, commitments, shieldCiphertext } = shieldEventArgs;
    if (
      treeNumber == null ||
      startPosition == null ||
      commitments == null ||
      shieldCiphertext == null
    ) {
      const err = new Error('Invalid ShieldEventArgs');
      EngineDebug.error(err);
      throw err;
    }

    const utxoTree = Number(treeNumber);
    const utxoStartingIndex = Number(startPosition);

    const formattedCommitments = V2Events.formatShieldCommitments(
      transactionHash,
      commitments,
      shieldCiphertext,
      blockNumber,
      utxoTree,
      utxoStartingIndex,
      fees,
      timestamp,
    );
    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      treeNumber: utxoTree,
      startPosition: utxoStartingIndex,
      commitments: formattedCommitments,
      blockNumber,
    };
  }

  static formatCommitmentCiphertext(
    commitmentCiphertext: CommitmentCiphertextStructOutput,
  ): CommitmentCiphertextV2 {
    const { blindedSenderViewingKey, blindedReceiverViewingKey, annotationData, memo } =
      commitmentCiphertext;
    const ciphertext = commitmentCiphertext.ciphertext.map(
      (el) => ByteUtils.formatToByteLength(el, ByteLength.UINT_256), // 32 bytes each.
    );
    const ivTag = ciphertext[0];

    return {
      ciphertext: {
        iv: ivTag.substring(0, 32),
        tag: ivTag.substring(32),
        data: ciphertext.slice(1),
      },
      blindedSenderViewingKey: ByteUtils.formatToByteLength(
        blindedSenderViewingKey,
        ByteLength.UINT_256,
      ), // 32 bytes each.
      blindedReceiverViewingKey: ByteUtils.formatToByteLength(
        blindedReceiverViewingKey,
        ByteLength.UINT_256,
      ), // 32 bytes each.
      annotationData,
      memo,
    };
  }

  private static formatTransactCommitments(
    transactionHash: string,
    hash: string[],
    commitments: CommitmentCiphertextStructOutput[],
    blockNumber: number,
    utxoTree: number,
    utxoStartingIndex: number,
    timestamp: Optional<number>,
  ): TransactCommitmentV2[] {
    return commitments.map((commitment, index) => {
      return {
        commitmentType: CommitmentType.TransactCommitmentV2,
        hash: ByteUtils.formatToByteLength(hash[index], ByteLength.UINT_256),
        txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
        timestamp,
        blockNumber,
        ciphertext: V2Events.formatCommitmentCiphertext(commitment),
        utxoTree,
        utxoIndex: utxoStartingIndex + index,
        railgunTxid: undefined,
      };
    });
  }

  static formatTransactEvent(
    transactEventArgs: TransactEvent.OutputObject,
    transactionHash: string,
    blockNumber: number,
    timestamp: Optional<number>,
  ): CommitmentEvent {
    const { treeNumber, startPosition, hash, ciphertext } = transactEventArgs;
    if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
      const err = new Error('Invalid TransactEventObject');
      EngineDebug.error(err);
      throw err;
    }

    const utxoTree = Number(treeNumber);
    const utxoStartingIndex = Number(startPosition);

    const formattedCommitments = V2Events.formatTransactCommitments(
      transactionHash,
      hash,
      ciphertext,
      blockNumber,
      utxoTree,
      utxoStartingIndex,
      timestamp,
    );
    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      treeNumber: utxoTree,
      startPosition: utxoStartingIndex,
      commitments: formattedCommitments,
      blockNumber,
    };
  }

  static formatUnshieldEvent(
    unshieldEventArgs: UnshieldEvent.OutputObject,
    transactionHash: string,
    blockNumber: number,
    eventLogIndex: number,
    timestamp: Optional<number>,
  ): UnshieldStoredEvent {
    const { to, token, amount, fee } = unshieldEventArgs;
    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      timestamp,
      toAddress: to,
      tokenType: Number(token.tokenType),
      tokenAddress: token.tokenAddress,
      tokenSubID: token.tokenSubID.toString(),
      amount: amount.toString(),
      fee: fee.toString(),
      blockNumber,
      eventLogIndex,
      railgunTxid: undefined,
      poisPerList: undefined,
    };
  }

  static async processShieldEvents(
    txidVersion: TXIDVersion,
    eventsListener: EventsCommitmentListener,
    logs: ShieldEvent.Log[],
  ): Promise<void> {
    const filtered = logs.filter((log) => log.args);
    if (logs.length !== filtered.length) {
      throw new Error('Args required for Shield events');
    }
    await Promise.all(
      filtered.map(async (log) => {
        const { args, transactionHash, blockNumber } = log;
        const { fees } = args;
        return eventsListener(txidVersion, [
          V2Events.formatShieldEvent(
            args,
            transactionHash,
            blockNumber,
            fees,
            undefined, // timestamp
          ),
        ]);
      }),
    );
  }

  static async processShieldEvents_LegacyShield_PreMar23(
    txidVersion: TXIDVersion,
    eventsListener: EventsCommitmentListener,
    logs: ShieldEvent_LegacyShield_PreMar23.Log[],
  ): Promise<void> {
    // NOTE: Legacy "Shield" event of the same name conflicts with the current ABI's Shield event.
    // It seems that the first ABI to load, with "Shield" event, for a given contract address,
    // sets a cached version of the ABI interface.
    // So, we need to custom-decode the legacy Shield event here.

    const iface = new Interface(
      ABIRailgunSmartWallet_Legacy_PreMar23.filter((fragment) => fragment.type === 'event'),
    );
    for (const log of logs) {
      const args = iface.decodeEventLog('Shield', log.data);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log.args = args as any;
    }

    const filtered = logs.filter((log) => log.args);
    if (logs.length !== filtered.length) {
      throw new Error('Args required for Legacy Shield events');
    }

    await Promise.all(
      filtered.map(async (event) => {
        const { args, transactionHash, blockNumber } = event;
        const fees: Optional<bigint[]> = undefined;
        return eventsListener(txidVersion, [
          V2Events.formatShieldEvent(
            args,
            transactionHash,
            blockNumber,
            fees,
            undefined, // timestamp
          ),
        ]);
      }),
    );
  }

  static async processTransactEvents(
    txidVersion: TXIDVersion,
    eventsListener: EventsCommitmentListener,
    logs: TransactEvent.Log[],
  ): Promise<void> {
    const filtered = logs.filter((log) => log.args);
    if (logs.length !== filtered.length) {
      throw new Error('Args required for Transact events');
    }
    await Promise.all(
      filtered.map(async (event) => {
        const { args, transactionHash, blockNumber } = event;
        return eventsListener(txidVersion, [
          V2Events.formatTransactEvent(
            args,
            transactionHash,
            blockNumber,
            undefined, // timestamp
          ),
        ]);
      }),
    );
  }

  static async processUnshieldEvents(
    txidVersion: TXIDVersion,
    eventsUnshieldListener: EventsUnshieldListener,
    logs: UnshieldEvent.Log[],
  ): Promise<void> {
    const unshields: UnshieldStoredEvent[] = [];

    const filtered = logs.filter((log) => log.args);
    if (logs.length !== filtered.length) {
      throw new Error('Args required for Unshield events');
    }
    for (const log of filtered) {
      const { args, transactionHash, blockNumber } = log;
      unshields.push(
        V2Events.formatUnshieldEvent(
          args,
          transactionHash,
          blockNumber,
          log.index,
          undefined, // timestamp
        ),
      );
    }

    await eventsUnshieldListener(txidVersion, unshields);
  }

  static formatNullifiedEvents(
    nullifierEventArgs: NullifiedEvent.OutputObject,
    transactionHash: string,
    blockNumber: number,
  ): Nullifier[] {
    const nullifiers: Nullifier[] = [];

    for (const nullifier of nullifierEventArgs.nullifier) {
      nullifiers.push({
        txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
        nullifier: ByteUtils.formatToByteLength(nullifier, ByteLength.UINT_256),
        treeNumber: Number(nullifierEventArgs.treeNumber),
        blockNumber,
      });
    }

    return nullifiers;
  }

  static async processNullifiedEvents(
    txidVersion: TXIDVersion,
    eventsNullifierListener: EventsNullifierListener,
    logs: NullifiedEvent.Log[],
  ): Promise<void> {
    const nullifiers: Nullifier[] = [];

    const filtered = logs.filter((log) => log.args);
    if (logs.length !== filtered.length) {
      throw new Error('Args required for Nullified events');
    }

    for (const log of filtered) {
      const { args, transactionHash, blockNumber } = log;
      nullifiers.push(...V2Events.formatNullifiedEvents(args, transactionHash, blockNumber));
    }

    await eventsNullifierListener(txidVersion, nullifiers);
  }
}
