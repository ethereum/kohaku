import { Result } from 'ethers';
import {
  AccumulatorStateUpdateEvent,
  PoseidonMerkleAccumulator,
} from '../../../abi/typechain/PoseidonMerkleAccumulator';
import {
  CommitmentEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsRailgunTransactionListenerV3,
  EventsUnshieldListener,
  UnshieldStoredEvent,
} from '../../../models/event-types';
import {
  CommitmentCiphertextV3,
  CommitmentType,
  Nullifier,
  RailgunTransactionV3,
  RailgunTransactionVersion,
  ShieldCommitment,
  TransactCommitmentV3,
  UnshieldRailgunTransactionData,
  XChaChaEncryptionAlgorithm,
} from '../../../models/formatted-types';
import { TREE_MAX_ITEMS } from '../../../models/merkletree-types';
import { TXIDVersion } from '../../../models/poi-types';
import {
  extractTokenHashFromCommitmentPreImageV3,
  getNoteHash,
  getUnshieldPreImageNoteHash,
  serializePreImage,
  serializeTokenData,
} from '../../../note/note-util';
import { isDefined } from '../../../utils/is-defined';
import { ByteLength, ByteUtils } from '../../../utils/bytes';
import { recursivelyDecodeResult } from '../../../utils/ethers';
import { EngineDebug } from '../../../debugger/debugger';
import { getRailgunTransactionIDHex } from '../../../transaction/railgun-txid';
import {
  GLOBAL_UTXO_POSITION_UNSHIELD_EVENT_HARDCODED_VALUE,
  GLOBAL_UTXO_TREE_UNSHIELD_EVENT_HARDCODED_VALUE,
} from '../../../poi/global-tree-position';

export class V3Events {
  static formatTransactEvent(
    transactionHash: string,
    blockNumber: number,
    commitmentHashes: string[],
    commitmentCiphertexts: {
      ciphertext: string;
      blindedSenderViewingKey: string;
      blindedReceiverViewingKey: string;
    }[],
    utxoTree: number,
    utxoStartingIndex: number,
    transactIndex: number,
    senderCiphertext: string,
    railgunTxid: string,
  ): CommitmentEvent {
    const formattedCommitments = V3Events.formatTransactCommitments(
      transactionHash,
      blockNumber,
      commitmentHashes,
      commitmentCiphertexts,
      utxoTree,
      utxoStartingIndex,
      transactIndex,
      senderCiphertext,
      railgunTxid,
    );

    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      treeNumber: utxoTree,
      startPosition: utxoStartingIndex,
      commitments: formattedCommitments,
      blockNumber,
    };
  }

  private static formatTransactCommitments(
    transactionHash: string,
    blockNumber: number,
    commitmentHashes: string[],
    commitmentCiphertexts: {
      ciphertext: string;
      blindedSenderViewingKey: string;
      blindedReceiverViewingKey: string;
    }[],
    utxoTree: number,
    utxoStartingIndex: number,
    transactIndex: number,
    senderCiphertext: string,
    railgunTxid: string,
  ): TransactCommitmentV3[] {
    return commitmentCiphertexts.map((commitmentCiphertext, index) => {
      return {
        commitmentType: CommitmentType.TransactCommitmentV3,
        hash: ByteUtils.formatToByteLength(commitmentHashes[index], ByteLength.UINT_256),
        txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
        timestamp: undefined,
        blockNumber,
        ciphertext: V3Events.formatCommitmentCiphertext(commitmentCiphertext),
        utxoTree,
        utxoIndex: utxoStartingIndex + index,
        transactCommitmentBatchIndex: transactIndex + index, // global index of commitment in the entire transaction batch (used to decrypt OutputType)
        railgunTxid,
        senderCiphertext,
      };
    });
  }

  static formatCommitmentCiphertext(commitmentCiphertext: {
    ciphertext: string;
    blindedSenderViewingKey: string;
    blindedReceiverViewingKey: string;
  }): CommitmentCiphertextV3 {
    const { blindedSenderViewingKey, blindedReceiverViewingKey } = commitmentCiphertext;

    const strippedCiphertext = ByteUtils.strip0x(commitmentCiphertext.ciphertext);
    const nonce = strippedCiphertext.slice(0, 32);
    const bundle = strippedCiphertext.slice(32);

    return {
      ciphertext: {
        algorithm: XChaChaEncryptionAlgorithm.XChaChaPoly1305,
        nonce,
        bundle,
      },
      blindedSenderViewingKey: ByteUtils.formatToByteLength(
        blindedSenderViewingKey,
        ByteLength.UINT_256,
      ), // 32 bytes each.
      blindedReceiverViewingKey: ByteUtils.formatToByteLength(
        blindedReceiverViewingKey,
        ByteLength.UINT_256,
      ), // 32 bytes each.
    };
  }

  static formatUnshieldEvent(
    transactionHash: string,
    blockNumber: number,
    unshieldPreimage: {
      npk: string;
      token: {
        tokenAddress: string;
        tokenType: bigint;
        tokenSubID: bigint;
      };
      value: bigint;
    },
    transactIndex: number,
    fee: bigint,
    railgunTxid: string,
  ): UnshieldStoredEvent {
    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      toAddress: ByteUtils.formatToByteLength(unshieldPreimage.npk, ByteLength.Address, true),
      tokenType: Number(unshieldPreimage.token.tokenType),
      tokenAddress: unshieldPreimage.token.tokenAddress,
      tokenSubID: unshieldPreimage.token.tokenSubID.toString(),
      amount: (unshieldPreimage.value - fee).toString(),
      fee: fee.toString(),
      blockNumber,
      eventLogIndex: transactIndex,
      railgunTxid,
      poisPerList: undefined,
      timestamp: undefined,
    };
  }

  static formatNullifiedEvents(
    transactionHash: string,
    blockNumber: number,
    spendAccumulatorNumber: number,
    nullifierHashes: string[],
  ): Nullifier[] {
    const nullifiers: Nullifier[] = [];

    for (const nullifierHash of nullifierHashes) {
      nullifiers.push({
        txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
        nullifier: ByteUtils.formatToByteLength(nullifierHash, ByteLength.UINT_256),
        treeNumber: spendAccumulatorNumber,
        blockNumber,
      });
    }

    return nullifiers;
  }

  static formatRailgunTransactionEvent(
    transactionHash: string,
    blockNumber: number,
    commitments: string[],
    nullifiers: string[],
    unshieldPreimage: {
      npk: string;
      token: {
        tokenAddress: string;
        tokenType: bigint;
        tokenSubID: bigint;
      };
      value: bigint;
    },
    boundParamsHash: string,
    utxoTreeIn: number,
    utxoTree: number,
    utxoBatchStartPosition: number,
    verificationHash: Optional<string>, // TODO-V3: This should be required when it's available from on-chain data.
  ): RailgunTransactionV3 {
    const hasUnshield = unshieldPreimage.value > 0n;
    const unshield: Optional<UnshieldRailgunTransactionData> = hasUnshield
      ? {
        toAddress: ByteUtils.formatToByteLength(unshieldPreimage.npk, ByteLength.Address, true),
        tokenData: serializeTokenData(
          unshieldPreimage.token.tokenAddress,
          unshieldPreimage.token.tokenType,
          unshieldPreimage.token.tokenSubID.toString(),
        ),
        value: unshieldPreimage.value.toString(),
      }
      : undefined;

    // Unshield-only transactions must have hardcoded utxoTreeOut and utxoBatchStartPositionOut of 99999.
    const isUnshieldOnly = commitments.length === 1 && hasUnshield;

    return {
      version: RailgunTransactionVersion.V3,
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      blockNumber,
      commitments,
      nullifiers,
      boundParamsHash,
      unshield,
      utxoTreeIn,
      utxoTreeOut: isUnshieldOnly ? GLOBAL_UTXO_TREE_UNSHIELD_EVENT_HARDCODED_VALUE : utxoTree,
      utxoBatchStartPositionOut: isUnshieldOnly
        ? GLOBAL_UTXO_POSITION_UNSHIELD_EVENT_HARDCODED_VALUE
        : utxoBatchStartPosition,
      verificationHash,
    };
  }

  static formatShieldEvent(
    transactionHash: string,
    blockNumber: number,
    from: string,
    shieldPreImage: {
      npk: string;
      token: {
        tokenAddress: string;
        tokenType: bigint;
        tokenSubID: bigint;
      };
      value: bigint;
    },
    shieldCiphertext: { encryptedBundle: [string, string, string]; shieldKey: string },
    utxoTree: number,
    utxoIndex: number,
    fee: bigint,
  ): CommitmentEvent {
    const formattedCommitment = V3Events.formatShieldCommitment(
      transactionHash,
      blockNumber,
      from,
      shieldPreImage,
      shieldCiphertext,
      utxoTree,
      utxoIndex,
      fee,
    );

    return {
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      treeNumber: utxoTree,
      startPosition: utxoIndex,
      commitments: [formattedCommitment],
      blockNumber,
    };
  }

  private static formatShieldCommitment(
    transactionHash: string,
    blockNumber: number,
    from: string,
    shieldPreImage: {
      npk: string;
      token: {
        tokenAddress: string;
        tokenType: bigint;
        tokenSubID: bigint;
      };
      value: bigint;
    },
    shieldCiphertext: { encryptedBundle: [string, string, string]; shieldKey: string },
    utxoTree: number,
    utxoIndex: number,
    fee: bigint,
  ): ShieldCommitment {
    const npk = ByteUtils.formatToByteLength(shieldPreImage.npk, ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      shieldPreImage.token.tokenAddress,
      shieldPreImage.token.tokenType,
      shieldPreImage.token.tokenSubID.toString(),
    );
    const { value } = shieldPreImage;
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    const commitment: ShieldCommitment = {
      commitmentType: CommitmentType.ShieldCommitment,
      hash: ByteUtils.nToHex(noteHash, ByteLength.UINT_256),
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      timestamp: undefined,
      blockNumber,
      preImage,
      encryptedBundle: shieldCiphertext.encryptedBundle,
      shieldKey: shieldCiphertext.shieldKey,
      fee: fee?.toString(),
      utxoTree,
      utxoIndex,
      from,
    };

    return commitment;
  }

  static async processAccumulatorUpdateEvents(
    txidVersion: TXIDVersion,
    logs: AccumulatorStateUpdateEvent.Log[],
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
  ): Promise<void> {
    const filtered = logs.filter((log) => log.args);

    if (logs.length !== filtered.length) {
      throw new Error('Args required for Nullified events');
    }

    await Promise.all(
      filtered.map(async (log) => {
        const { args, transactionHash, blockNumber } = log;

        await V3Events.processAccumulatorEvent(
          txidVersion,
          args as unknown as Result,
          transactionHash,
          blockNumber,
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          async () => { }, // Do not trigger wallet scans
        );
      }),
    );
  }

  static async processAccumulatorEvent(
    txidVersion: TXIDVersion,
    args: Result,
    transactionHash: string,
    blockNumber: number,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    triggerWalletBalanceDecryptions: (txidVersion: TXIDVersion) => Promise<void>,
  ) {
    try {
      const { update, accumulatorNumber, startPosition } = getAccumulatorEventObject(args);

      const {
        commitments: unformattedCommitments,
        transactions: unformattedTransactions,
        shields: unformattedShields,
        commitmentCiphertext: unformattedCommitmentCiphertext,
        treasuryFees: unformattedTreasuryFees,
        senderCiphertext,
      } = recusivelyDecodeAccumulatorUpdateObject(update);

      // 'commitments' is potentially parsed as an object.
      const commitments = 'length' in unformattedCommitments ? unformattedCommitments : [];
      // 'transactions' is potentially parsed as an object.
      const transactions = 'length' in unformattedTransactions ? unformattedTransactions : [];
      // 'shields' is potentially parsed as an object.
      const shields = 'length' in unformattedShields ? unformattedShields : [];
      // 'commitmentCiphertext' is potentially parsed as an object.
      const commitmentCiphertext =
        'length' in unformattedCommitmentCiphertext ? unformattedCommitmentCiphertext : [];
      // 'treasuryFees' is potentially parsed as an object.
      const treasuryFees = 'length' in unformattedTreasuryFees ? unformattedTreasuryFees : [];

      const treasuryFeeMap: { [tokenHash: string]: { shield: bigint; unshield: bigint } } = {};

      for (const { tokenID, fee } of treasuryFees) {
        const strippedTokenID = ByteUtils.strip0x(tokenID);
        const unshield = transactions.find((transaction) => {
          const unshieldTokenHash = extractTokenHashFromCommitmentPreImageV3(
            transaction.unshieldPreimage,
          );

          return unshieldTokenHash === strippedTokenID;
        });
        const unshieldValue = unshield?.unshieldPreimage.value ?? 0n;

        const shield = shields.find(({ preimage }) => {
          const shieldTokenHash = extractTokenHashFromCommitmentPreImageV3(preimage);

          return shieldTokenHash === strippedTokenID;
        });
        const shieldValue = shield?.preimage.value ?? 0n;

        let shieldFeePortion;
        let unshieldFeePortion;

        // TODO: This calculation assumes that the shield and unshield fees are equal.
        if (unshieldValue < shieldValue) {
          unshieldFeePortion = (unshieldValue * fee) / (unshieldValue + shieldValue);
          shieldFeePortion = fee - unshieldFeePortion;
        } else {
          shieldFeePortion = (shieldValue * fee) / (shieldValue + unshieldValue);
          unshieldFeePortion = fee - shieldFeePortion;
        }

        treasuryFeeMap[strippedTokenID] = {
          shield: shieldFeePortion,
          unshield: unshieldFeePortion,
        };
      }

      let commitmentsStartIndex = 0;

      let utxoTree = Number(accumulatorNumber);
      let utxoStartingIndex = Number(startPosition);

      const allCommitmentEvents: CommitmentEvent[] = [];

      for (let i = 0; i < transactions.length; i += 1) {
        const {
          nullifiers,
          commitmentsCount,
          spendAccumulatorNumber,
          unshieldPreimage,
          boundParamsHash,
        } = transactions[i];

        const commitmentsEndIndex = commitmentsStartIndex + Number(commitmentsCount);
        const commitmentHashes = commitments.slice(commitmentsStartIndex, commitmentsEndIndex);
        const commitmentCiphertexts = commitmentCiphertext.slice(
          commitmentsStartIndex,
          commitmentsEndIndex,
        );

        if (commitmentHashes.length !== Number(commitmentsCount)) {
          throw new Error('Expected commitmentHashes length to match commitmentsCount');
        }

        if (commitmentCiphertexts.length !== Number(commitmentsCount)) {
          throw new Error('Expected commitmentCiphertexts length to match commitmentsCount');
        }

        commitmentsStartIndex = commitmentsEndIndex;

        const hasUnshield = unshieldPreimage.value > 0n;

        const commitmentsWithUnshieldHash = hasUnshield
          ? [
            ...commitmentHashes,
            ByteUtils.nToHex(
              getUnshieldPreImageNoteHash(unshieldPreimage),
              ByteLength.UINT_256,
              true,
            ),
          ]
          : commitmentHashes;

        const formattedBoundParamsHash = ByteUtils.formatToByteLength(
          boundParamsHash,
          ByteLength.UINT_256,
          false,
        );

        const railgunTransaction = V3Events.formatRailgunTransactionEvent(
          transactionHash,
          blockNumber,
          commitmentsWithUnshieldHash,
          nullifiers,
          unshieldPreimage,
          formattedBoundParamsHash,
          Number(spendAccumulatorNumber), // utxoTreeIn
          utxoTree,
          utxoStartingIndex,
          undefined, // TODO-V3: add verificationHash
        );

        await eventsRailgunTransactionsV3Listener(txidVersion, [railgunTransaction]);

        const railgunTxid = getRailgunTransactionIDHex(railgunTransaction);

        const transactEvent = V3Events.formatTransactEvent(
          transactionHash,
          blockNumber,
          commitmentHashes,
          commitmentCiphertexts,
          utxoTree,
          utxoStartingIndex,
          i, // transactCommitmentBatchIndex
          senderCiphertext,
          railgunTxid,
        );

        allCommitmentEvents.push(transactEvent);

        const nullifiedEvents = V3Events.formatNullifiedEvents(
          transactionHash,
          blockNumber,
          Number(spendAccumulatorNumber),
          nullifiers,
        );

        await eventsNullifierListener(txidVersion, nullifiedEvents);

        if (hasUnshield) {
          const isERC20 = unshieldPreimage.token.tokenType === 0n;
          const totalUnshieldValuesForToken = transactions.reduce((acc, curr) => {
            return acc + curr.unshieldPreimage.value;
          }, 0n);
          const unshieldTokenHash = extractTokenHashFromCommitmentPreImageV3(unshieldPreimage);

          if (isERC20 && !isDefined(treasuryFeeMap[unshieldTokenHash])) {
            throw new Error('Expected unshield token hash in treasuryFeeMap');
          }

          const unshieldFee =
            totalUnshieldValuesForToken > 0n
              ? (treasuryFeeMap[unshieldTokenHash].unshield * unshieldPreimage.value) /
              totalUnshieldValuesForToken
              : 0n;

          if (
            isERC20 &&
            unshieldPreimage.value >= 400n && // TODO: This will need to change if the unshield fee is different than 0.25%.
            (!isDefined(unshieldFee) || unshieldFee === 0n)
          ) {
            throw new Error('Expected an unshield fee in treasuryFeeMap');
          }

          const unshieldEvent = V3Events.formatUnshieldEvent(
            transactionHash,
            blockNumber,
            unshieldPreimage,
            i, // transaction index
            unshieldFee,
            railgunTxid,
          );


          await eventsUnshieldListener(txidVersion, [unshieldEvent]);
        }

        utxoStartingIndex += Number(commitmentsCount);

        if (utxoStartingIndex >= TREE_MAX_ITEMS) {
          utxoStartingIndex = 0;
          utxoTree += 1;
        }
      }

      for (const shield of shields) {
        const totalShieldValuesForToken = shields.reduce((acc, curr) => {
          return acc + curr.preimage.value;
        }, 0n);

        const { from, preimage, ciphertext } = shield;
        const shieldTokenHash = extractTokenHashFromCommitmentPreImageV3(preimage);
        const isERC20 = preimage.token.tokenType === 0n;

        if (isERC20 && !isDefined(treasuryFeeMap[shieldTokenHash])) {
          throw new Error('Expected shield token hash in treasuryFeeMap');
        }

        // Assume equal shield fees across each shield for this token.
        const shieldFee =
          totalShieldValuesForToken > 0n
            ? (treasuryFeeMap[shieldTokenHash].shield * shield.preimage.value) /
            totalShieldValuesForToken
            : 0n;

        if (
          isERC20 &&
          shield.preimage.value >= 400n && // TODO: This will need to change if the unshield fee is different than 0.25%.
          (!isDefined(shieldFee) || shieldFee === 0n)
        ) {
          throw new Error('Expected a shield fee in treasuryFeeMap');
        }

        const shieldEvent = V3Events.formatShieldEvent(
          transactionHash,
          blockNumber,
          from,
          preimage,
          ciphertext,
          utxoTree,
          utxoStartingIndex,
          shieldFee,
        );

        allCommitmentEvents.push(shieldEvent);

        utxoStartingIndex += 1;

        if (utxoStartingIndex >= TREE_MAX_ITEMS) {
          utxoStartingIndex = 0;
          utxoTree += 1;
        }
      }

      await eventsCommitmentListener(txidVersion, allCommitmentEvents);

      // Trigger wallet scans after all events are processed.
      await triggerWalletBalanceDecryptions(txidVersion);
    } catch (cause) {

      const err = new Error('Failed to process V3 accumulator update event', { cause });

      EngineDebug.error(err);
      throw err;
    }
  }
}

const getAccumulatorEventObject = (args: Result): AccumulatorStateUpdateEvent.OutputObject => {
  try {
    return args.toObject() as AccumulatorStateUpdateEvent.OutputObject;
  } catch (err) {
    console.error(err);

    return args as unknown as AccumulatorStateUpdateEvent.OutputObject;
  }
};

const recusivelyDecodeAccumulatorUpdateObject = (
  args: PoseidonMerkleAccumulator.StateUpdateStructOutput,
): PoseidonMerkleAccumulator.StateUpdateStructOutput => {
  try {
    return recursivelyDecodeResult(
      args as unknown as Result,
    ) as PoseidonMerkleAccumulator.StateUpdateStructOutput;
  } catch (err) {
    console.error(err);

    return args as unknown as PoseidonMerkleAccumulator.StateUpdateStructOutput;
  }
};
