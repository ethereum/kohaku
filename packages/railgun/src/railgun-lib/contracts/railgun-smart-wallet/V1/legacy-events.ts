import {
  NullifiersEvent as LegacyNullifiersEvent,
  CommitmentBatchEvent as LegacyCommitmentBatchEvent,
  CommitmentPreimageStructOutput as LegacyCommitmentPreimageStructOutput,
  GeneratedCommitmentBatchEvent as LegacyGeneratedCommitmentBatchEvent,
  CommitmentCiphertextStructOutput as LegacyCommitmentCiphertextStructOutput,
} from '../../../abi/typechain/RailgunLogic_LegacyEvents';
import {
  CommitmentEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
} from '../../../models/event-types';
import {
  CommitmentType,
  LegacyCommitmentCiphertext,
  LegacyEncryptedCommitment,
  LegacyGeneratedCommitment,
  Nullifier,
} from '../../../models/formatted-types';
import { getNoteHash, serializePreImage, serializeTokenData } from '../../../note/note-util';
import { ByteLength, ByteUtils } from '../../../utils';
import { EngineDebug } from '../../../debugger/debugger';
import { TXIDVersion } from '../../../models/poi-types';

export function formatLegacyGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: LegacyCommitmentPreimageStructOutput[],
  encryptedRandoms: [bigint, bigint][],
  blockNumber: number,
  utxoTree: number,
  utxoStartingIndex: number,
): LegacyGeneratedCommitment[] {
  const randomFormatted: [string, string][] = encryptedRandoms.map((encryptedRandom) => [
    ByteUtils.nToHex(encryptedRandom[0], ByteLength.UINT_256),
    ByteUtils.nToHex(encryptedRandom[1], ByteLength.UINT_128),
  ]);
  return preImages.map((commitmentPreImage, index) => {
    const npk = ByteUtils.formatToByteLength(commitmentPreImage.npk.toString(), ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toString(),
    );
    const { value } = commitmentPreImage;
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    return {
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: ByteUtils.nToHex(noteHash, ByteLength.UINT_256),
      txid: transactionHash,
      timestamp: undefined,
      blockNumber,
      preImage,
      encryptedRandom: randomFormatted[index],
      utxoTree,
      utxoIndex: utxoStartingIndex + index,
    };
  });
}

export function formatLegacyGeneratedCommitmentBatchEvent(
  commitmentBatchArgs: LegacyGeneratedCommitmentBatchEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, commitments, encryptedRandom } = commitmentBatchArgs;
  if (
    treeNumber == null ||
    startPosition == null ||
    commitments == null ||
    encryptedRandom == null
  ) {
    const err = new Error('Invalid GeneratedCommitmentBatchEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const utxoTree = Number(treeNumber);
  const utxoStartingIndex = Number(startPosition);

  const formattedCommitments: LegacyGeneratedCommitment[] =
    formatLegacyGeneratedCommitmentBatchCommitments(
      transactionHash,
      commitments,
      encryptedRandom,
      blockNumber,
      utxoTree,
      utxoStartingIndex,
    );
  return {
    txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: utxoTree,
    startPosition: utxoStartingIndex,
    commitments: formattedCommitments,
    blockNumber,
  };
}

function formatLegacyCommitmentCiphertext(
  commitment: LegacyCommitmentCiphertextStructOutput,
): LegacyCommitmentCiphertext {
  const { ephemeralKeys, memo } = commitment;
  const ciphertext = commitment.ciphertext.map(
    (el) => ByteUtils.nToHex(el, ByteLength.UINT_256), // 32 bytes each.
  );
  const ivTag = ciphertext[0];

  return {
    ciphertext: {
      iv: ivTag.substring(0, 32),
      tag: ivTag.substring(32),
      data: ciphertext.slice(1),
    },
    ephemeralKeys: ephemeralKeys.map(
      (key) => ByteUtils.nToHex(key, ByteLength.UINT_256), // 32 bytes each.
    ),
    memo: (memo ?? []).map(
      (el) => ByteUtils.nToHex(el, ByteLength.UINT_256), // 32 bytes each.
    ),
  };
}

export function formatLegacyCommitmentBatchCommitments(
  transactionHash: string,
  hash: bigint[],
  commitments: LegacyCommitmentCiphertextStructOutput[],
  blockNumber: number,
  utxoTree: number,
  utxoStartingIndex: number,
): LegacyEncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    return {
      commitmentType: CommitmentType.LegacyEncryptedCommitment,
      hash: ByteUtils.nToHex(hash[index], ByteLength.UINT_256),
      txid: transactionHash,
      timestamp: undefined,
      blockNumber,
      ciphertext: formatLegacyCommitmentCiphertext(commitment),
      utxoTree,
      utxoIndex: utxoStartingIndex + index,
      railgunTxid: undefined,
    };
  });
}

export function formatLegacyCommitmentBatchEvent(
  commitmentBatchArgs: LegacyCommitmentBatchEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, hash, ciphertext } = commitmentBatchArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid CommitmentBatchEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const utxoTree = Number(treeNumber);
  const utxoStartingIndex = Number(startPosition);

  const formattedCommitments: LegacyEncryptedCommitment[] = formatLegacyCommitmentBatchCommitments(
    transactionHash,
    hash,
    ciphertext,
    blockNumber,
    utxoTree,
    utxoStartingIndex,
  );
  return {
    txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: utxoTree,
    startPosition: utxoStartingIndex,
    commitments: formattedCommitments,
    blockNumber,
  };
}

export async function processGeneratedCommitmentEvents(
  txidVersion: TXIDVersion,
  eventsListener: EventsCommitmentListener,
  logs: LegacyGeneratedCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(txidVersion, [
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      ]);
    }),
  );
}

export async function processCommitmentBatchEvents(
  txidVersion: TXIDVersion,
  eventsListener: EventsCommitmentListener,
  logs: LegacyCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(txidVersion, [
        formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber),
      ]);
    }),
  );
}

export function formatLegacyNullifierEvents(
  nullifierEventArgs: LegacyNullifiersEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  for (const nullifier of nullifierEventArgs.nullifier) {
    nullifiers.push({
      txid: ByteUtils.formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: ByteUtils.nToHex(nullifier, ByteLength.UINT_256),
      treeNumber: Number(nullifierEventArgs.treeNumber),
      blockNumber,
    });
  }

  return nullifiers;
}

export async function processLegacyGeneratedCommitmentEvents(
  txidVersion: TXIDVersion,
  eventsListener: EventsCommitmentListener,
  logs: LegacyGeneratedCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(txidVersion, [
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      ]);
    }),
  );
}

export async function processLegacyCommitmentBatchEvents(
  txidVersion: TXIDVersion,
  eventsListener: EventsCommitmentListener,
  logs: LegacyCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(txidVersion, [
        formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber),
      ]);
    }),
  );
}

export async function processLegacyNullifierEvents(
  txidVersion: TXIDVersion,
  eventsNullifierListener: EventsNullifierListener,
  logs: LegacyNullifiersEvent.Log[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = logs.filter((log) => log.args);
  for (const event of filtered) {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatLegacyNullifierEvents(args, transactionHash, blockNumber));
  }

  await eventsNullifierListener(txidVersion, nullifiers);
}
