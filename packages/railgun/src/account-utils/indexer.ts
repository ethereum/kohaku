import { Interface } from 'ethers';
import { ABIRailgunSmartWallet } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note } from '../railgun-logic/logic/note';
import { bigIntToArray, hexStringToArray } from '../railgun-logic/global/bytes';
import { getTokenID } from '../railgun-logic/logic/note';
import { hash } from '../railgun-logic/global/crypto';
import type { RailgunProvider } from '../provider';
import type { RailgunLog, TransactEventObject, ShieldEventObject, NullifiedEventObject, TokenType, ChainId } from './types';
import { RAILGUN_CONFIG_BY_CHAIN_ID, TOTAL_LEAVES } from '../config';
import { progressBar } from '../utils/progress';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

/**
 * Checks if an error is a block range error from RPC provider.
 *
 * @param e - The error object to check
 * @returns True if the error indicates a block range resolution failure
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRangeErr(e: any): boolean {
  const message = String(e?.error?.message || e?.message || e?.info?.error?.message || "");
  return (
    e?.error?.code === -32001 ||
    e?.code === -32600 ||
    /failed to resolve block range/i.test(message) ||
    /block range/i.test(message) ||
    /eth_getLogs/i.test(message)
  );
}

/**
 * Retrieves all Railgun logs from a given block range with adaptive batch sizing.
 * Automatically handles RPC rate limits by adjusting batch sizes when range errors occur.
 *
 * @param provider - The RailgunProvider to query logs from
 * @param chainId - The chain ID to get the appropriate Railgun contract address
 * @param startBlock - The starting block number (inclusive)
 * @param endBlock - The ending block number (inclusive)
 * @returns Promise that resolves to an array of all logs from the specified range
 */
export const getAllLogs = async (
  provider: RailgunProvider,
  chainId: ChainId,
  startBlock: number,
  endBlock: number
): Promise<RailgunLog[]> => {
  const MAX_BATCH = 1200;
  const MIN_BATCH = 1;
  const railgunAddress = RAILGUN_CONFIG_BY_CHAIN_ID[chainId]?.RAILGUN_ADDRESS;

  if (!railgunAddress) {
    throw new Error(`Chain ID ${chainId} not supported`);
  }

  let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
  let from = startBlock;
  const allLogs: RailgunLog[] = [];

  while (from <= endBlock) {
    const to = Math.min(from + batch - 1, endBlock);
    try {
      await new Promise(r => setTimeout(r, 400)); // light pacing
      console.log(progressBar(startBlock, from, endBlock));
      const logs = await provider.getLogs({
        address: railgunAddress,
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...logs);
      from = to + 1;                 // advance
      batch = Math.min(batch * 2, MAX_BATCH); // grow again after success
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (isRangeErr(e)) {
        if (batch > MIN_BATCH) {
          batch = Math.max(MIN_BATCH, Math.floor(batch / 2)); // shrink and retry same 'from'
          continue;
        }
        // single-block still fails: skip this block to move on
        from = to + 1;
        continue;
      }
      throw e; // non-range error -> surface it
    }
  }

  return allLogs;
};

/**
 * Processes a blockchain log to update account state.
 * Handles Shield, Transact, and Nullified events to maintain merkle trees and note books.
 *
 * @param log - The blockchain log to process
 * @param merkleTrees - Array of merkle trees to update
 * @param noteBooks - Array of note books to update
 * @param viewingKey - The viewing private key for decryption
 * @param spendingKey - The spending private key for decryption
 * @param skipMerkleTree - If true, skips merkle tree updates (useful for batch processing)
 * @default false
 */
export async function processLog(
  log: RailgunLog,
  merkleTrees: MerkleTree[],
  noteBooks: NoteBook[],
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
  skipMerkleTree: boolean = false
): Promise<void> {
  // Parse log
  const parsedLog = RAILGUN_INTERFACE.parseLog({
    topics: [...log.topics],
    data: log.data,
  });
  if (!parsedLog) return;

  // Check log type
  if (parsedLog.name === 'Shield') {
    await processShieldEvent(
      parsedLog.args as unknown as ShieldEventObject,
      merkleTrees,
      noteBooks,
      viewingKey,
      spendingKey,
      skipMerkleTree
    );
  } else if (parsedLog.name === 'Transact') {
    await processTransactEvent(
      parsedLog.args as unknown as TransactEventObject,
      merkleTrees,
      noteBooks,
      viewingKey,
      spendingKey,
      skipMerkleTree
    );
  } else if (parsedLog.name === 'Nullified' && !skipMerkleTree) {
    await processNullifiedEvent(
      parsedLog.args as unknown as NullifiedEventObject,
      merkleTrees,
      noteBooks
    );
  }
}

async function processShieldEvent(
  args: ShieldEventObject,
  merkleTrees: MerkleTree[],
  noteBooks: NoteBook[],
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
  skipMerkleTree: boolean
): Promise<void> {
  // Get start position
  const startPosition = Number(args.startPosition.toString());

  // Get tree number
  const treeNumber = Number(args.treeNumber.toString());

  if (!skipMerkleTree) {
    // Check tree boundary
    const isCrossingTreeBoundary = startPosition + args.commitments.length > TOTAL_LEAVES;

    // Get leaves
    const leaves = await Promise.all(
      args.commitments.map((commitment) =>
        hash.poseidon([
          hexStringToArray(commitment.npk),
          getTokenID({
            tokenType: Number(commitment.token.tokenType.toString()) as TokenType,
            tokenAddress: commitment.token.tokenAddress,
            tokenSubID: BigInt(commitment.token.tokenSubID),
          }),
          bigIntToArray(BigInt(commitment.value), 32),
        ]),
      ),
    );

    // Insert leaves
    if (isCrossingTreeBoundary) {
      if (!merkleTrees[treeNumber+1]) {
        merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
        noteBooks[treeNumber+1] = new NoteBook();
      }
      merkleTrees[treeNumber+1]!.insertLeaves(leaves, 0);
    } else {
      if (!merkleTrees[treeNumber]) {
        merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
        noteBooks[treeNumber] = new NoteBook();
      }
      merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
    }
  }

  args.shieldCiphertext.map((shieldCiphertext, index) => {
    // Try to decrypt
    const decrypted = Note.decryptShield(
      hexStringToArray(shieldCiphertext.shieldKey),
      shieldCiphertext.encryptedBundle.map(hexStringToArray) as [
        Uint8Array,
        Uint8Array,
        Uint8Array,
      ],
      {
        tokenType: Number(args.commitments[index]!.token.tokenType.toString()) as TokenType,
        tokenAddress: args.commitments[index]!.token.tokenAddress,
        tokenSubID: BigInt(args.commitments[index]!.token.tokenSubID),
      },
      BigInt(args.commitments[index]!.value),
      viewingKey,
      spendingKey,
    );

    // Insert into note array in same index as merkle tree
    if (decrypted) {
      if (startPosition+index >= TOTAL_LEAVES) {
        noteBooks[treeNumber+1]!.notes[startPosition+index-TOTAL_LEAVES] = decrypted;
      } else {
        noteBooks[treeNumber]!.notes[startPosition+index] = decrypted;
      }
    }
  });
}

async function processTransactEvent(
  args: TransactEventObject,
  merkleTrees: MerkleTree[],
  noteBooks: NoteBook[],
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
  skipMerkleTree: boolean
): Promise<void> {
  // Get start position
  const startPosition = Number(args.startPosition.toString());

  // Get tree number
  const treeNumber = Number(args.treeNumber.toString());

  if (!skipMerkleTree) {
    // Check tree boundary
    const isCrossingTreeBoundary = startPosition + args.hash.length > TOTAL_LEAVES;

    // Get leaves
    const leaves = args.hash.map((noteHash) => hexStringToArray(noteHash));

    // Insert leaves
    if (isCrossingTreeBoundary) {
      if (!merkleTrees[treeNumber+1]) {
        merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
        noteBooks[treeNumber+1] = new NoteBook();
      }
      merkleTrees[treeNumber+1]!.insertLeaves(leaves, 0);
    } else {
      if (!merkleTrees[treeNumber]) {
        merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
        noteBooks[treeNumber] = new NoteBook();
      }
      merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
    }
  }

  // Loop through each token we're scanning
  await Promise.all(
    // Loop through every note and try to decrypt as token
    args.ciphertext.map(async (ciphertext, index) => {
      // Attempt to decrypt note with token
      const note = await Note.decrypt(
        {
          ciphertext: [
            hexStringToArray(ciphertext.ciphertext[0]),
            hexStringToArray(ciphertext.ciphertext[1]),
            hexStringToArray(ciphertext.ciphertext[2]),
            hexStringToArray(ciphertext.ciphertext[3]),
          ],
          blindedSenderViewingKey: hexStringToArray(
            ciphertext.blindedSenderViewingKey,
          ),
          blindedReceiverViewingKey: hexStringToArray(
            ciphertext.blindedReceiverViewingKey,
          ),
          annotationData: hexStringToArray(ciphertext.annotationData),
          memo: hexStringToArray(ciphertext.memo),
        },
        viewingKey,
        spendingKey,
      );

      // If note was decrypted add to wallet
      if (note) {
        if (startPosition+index >= TOTAL_LEAVES) {
          noteBooks[treeNumber+1]!.notes[startPosition + index - TOTAL_LEAVES] = note;
        } else {
          noteBooks[treeNumber]!.notes[startPosition + index] = note;
        }
      }
    }),
  );
}

async function processNullifiedEvent(
  args: NullifiedEventObject,
  merkleTrees: MerkleTree[],
  noteBooks: NoteBook[]
): Promise<void> {
  // Get tree number
  const treeNumber = Number(args.treeNumber.toString());

  // Create new merkleTrees and noteBooks if necessary
  if (!merkleTrees[treeNumber]) {
    merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
    noteBooks[treeNumber] = new NoteBook();
  }

  const nullifiersFormatted = args.nullifier.map((nullifier) =>
    hexStringToArray(nullifier),
  );
  merkleTrees[treeNumber]!.nullifiers.push(...nullifiersFormatted);
}
