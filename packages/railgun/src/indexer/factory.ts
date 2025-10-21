/* eslint-disable max-lines */
import { Interface } from 'ethers';
import { MerkleTree } from '../railgun/logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun/logic/logic/wallet';
import { Note } from '../railgun/logic/logic/note';
import { ABIRailgunSmartWallet } from '../railgun/lib/abi/abi';
import { hexStringToArray, bigIntToArray } from '../railgun/logic/global/bytes';
import { getTokenID } from '../railgun/logic/logic/note';
import { hash } from '../railgun/logic/global/crypto';
import { ByteUtils } from '../railgun/lib/utils/bytes';
import { RAILGUN_CONFIG_BY_CHAIN_ID, TOTAL_LEAVES } from '../config';
import { InMemoryIndexerStorage } from './storage';
import { progressBar } from '../utils/progress';
import type {
  RailgunIndexer,
  CreateRailgunIndexerOptions,
  RailgunIndexerAccountHandle,
  RailgunLog,
  ProcessLogsOptions,
  GetAllLogsOptions,
  ShieldEventObject,
  TransactEventObject,
  NullifiedEventObject,
  TokenType,
  SerializedMerkleTree,
  RailgunIndexerSnapshot,
} from './types';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isRangeErr = (e: any): boolean => {
  const message = String(e?.error?.message || e?.message || e?.info?.error?.message || '');

  return (
    e?.error?.code === -32001 ||
    e?.code === -32600 ||
    /failed to resolve block range/i.test(message) ||
    /block range/i.test(message) ||
    /eth_getLogs/i.test(message)
  );
};

const parseLog = (log: RailgunLog) =>
  RAILGUN_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });

export const createRailgunIndexer = async ({
  chainId,
  provider,
  storage,
}: CreateRailgunIndexerOptions): Promise<RailgunIndexer> => {
  const network = RAILGUN_CONFIG_BY_CHAIN_ID[chainId];

  if (!network) {
    throw new Error(`Chain ID ${chainId} not supported`);
  }

  const merkleTrees: MerkleTree[] = [];
  const accounts = new Set<RailgunIndexerAccountHandle>();
  let latestSyncedBlock: number | undefined;
  const indexerStorage = storage ?? new InMemoryIndexerStorage();

  // Load cached state
  const snapshot = await indexerStorage.load();

  if (snapshot) {
    for (let i = 0; i < snapshot.merkleTrees.length; i++) {
      const tree = await MerkleTree.createTree(i);

      tree.tree = snapshot.merkleTrees[i]!.tree.map((level: string[]) =>
        level.map(hexStringToArray),
      );
      tree.nullifiers = snapshot.merkleTrees[i]!.nullifiers.map(hexStringToArray);
      merkleTrees[i] = tree;
    }
    latestSyncedBlock = snapshot.latestSyncedBlock;
  }

  const serializeTrees = (): SerializedMerkleTree[] => {
    return merkleTrees.map((tree) => ({
      tree: tree.tree.map((level: Uint8Array[]) => level.map((leaf: Uint8Array) => ByteUtils.hexlify(leaf, true))),
      nullifiers: tree.nullifiers.map((nullifier: Uint8Array) => ByteUtils.hexlify(nullifier, true)),
    }));
  };

  const saveState = async () => {
    await indexerStorage.save({
      merkleTrees: serializeTrees(),
      latestSyncedBlock,
    });
  };

  const fetchLogs = async (
    startBlock: number,
    endBlock: number,
    options: GetAllLogsOptions = {},
  ): Promise<RailgunLog[]> => {
    const {
      maxBatchSize = 1200,
      minBatchSize = 1,
      throttleMs = 400,
      reportProgress = true,
      onProgress,
    } = options;

    const emitProgress = (fromBlock: number, toBlock: number, batchSize: number) => {
      if (onProgress) {
        onProgress({
          startBlock,
          endBlock,
          currentFromBlock: fromBlock,
          currentToBlock: toBlock,
          batchSize,
        });
      } else if (reportProgress) {
        console.log(progressBar(startBlock, fromBlock, endBlock));
      }
    };

    let batch = Math.min(maxBatchSize, Math.max(1, endBlock - startBlock + 1));
    let from = startBlock;
    const allLogs: RailgunLog[] = [];

    while (from <= endBlock) {
      const to = Math.min(from + batch - 1, endBlock);

      emitProgress(from, to, batch);

      try {
        if (throttleMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, throttleMs));
        }

        const logs = await provider.getLogs({
          address: network.RAILGUN_ADDRESS,
          fromBlock: from,
          toBlock: to,
        });

        allLogs.push(...logs);
        from = to + 1;
        batch = Math.min(batch * 2, maxBatchSize);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (isRangeErr(e)) {
          if (batch > minBatchSize) {
            batch = Math.max(minBatchSize, Math.floor(batch / 2));
            continue;
          }

          from = to + 1;
          continue;
        }

        throw e;
      }
    }

    return allLogs;
  };

  const processLogs = async (
    logs: RailgunLog[],
    options: ProcessLogsOptions = {},
  ): Promise<void> => {
    if (logs.length === 0) return;

    const skipMerkleTree = options.skipMerkleTree ?? false;

    for (const log of logs) {
      const parsedLog = parseLog(log);

      if (!parsedLog) continue;

      if (parsedLog.name === 'Shield') {
        const args = parsedLog.args as unknown as ShieldEventObject;
        const startPosition = Number(args.startPosition.toString());
        const treeNumber = Number(args.treeNumber.toString());

        if (!skipMerkleTree) {
          const isCrossingTreeBoundary = startPosition + args.commitments.length > TOTAL_LEAVES;

          const leaves = await Promise.all(
            args.commitments.map((commitment: ShieldEventObject['commitments'][number]) =>
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

          if (isCrossingTreeBoundary) {
            if (!merkleTrees[treeNumber + 1]) {
              merkleTrees[treeNumber + 1] = await MerkleTree.createTree(treeNumber + 1);
            }

            merkleTrees[treeNumber + 1]!.insertLeaves(leaves, 0);
          } else {
            if (!merkleTrees[treeNumber]) {
              merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
            }

            merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
          }
        }

        // Process for each registered account
        for (const account of accounts) {
          const { viewingKey, spendingKey } = await account.getKeys();

          if (!account.noteBooks[treeNumber]) {
            account.noteBooks[treeNumber] = new NoteBook();
          }

          if (!account.noteBooks[treeNumber + 1]) {
            account.noteBooks[treeNumber + 1] = new NoteBook();
          }

          args.shieldCiphertext.forEach((shieldCiphertext: ShieldEventObject['shieldCiphertext'][number], index: number) => {
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

            if (!decrypted) return;

            if (startPosition + index >= TOTAL_LEAVES) {
              account.noteBooks[treeNumber + 1]!.notes[startPosition + index - TOTAL_LEAVES] = decrypted;
            } else {
              account.noteBooks[treeNumber]!.notes[startPosition + index] = decrypted;
            }
          });
        }
      } else if (parsedLog.name === 'Transact') {
        const args = parsedLog.args as unknown as TransactEventObject;
        const startPosition = Number(args.startPosition.toString());
        const treeNumber = Number(args.treeNumber.toString());

        if (!skipMerkleTree) {
          const isCrossingTreeBoundary = startPosition + args.hash.length > TOTAL_LEAVES;
          const leaves = args.hash.map((noteHash: string) => hexStringToArray(noteHash));

          if (isCrossingTreeBoundary) {
            if (!merkleTrees[treeNumber + 1]) {
              merkleTrees[treeNumber + 1] = await MerkleTree.createTree(treeNumber + 1);
            }

            merkleTrees[treeNumber + 1]!.insertLeaves(leaves, 0);
          } else {
            if (!merkleTrees[treeNumber]) {
              merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
            }

            merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
          }
        }

        // Process for each registered account
        for (const account of accounts) {
          const { viewingKey, spendingKey } = await account.getKeys();

          if (!account.noteBooks[treeNumber]) {
            account.noteBooks[treeNumber] = new NoteBook();
          }

          if (!account.noteBooks[treeNumber + 1]) {
            account.noteBooks[treeNumber + 1] = new NoteBook();
          }

          await Promise.all(
            args.ciphertext.map(async (ciphertext: TransactEventObject['ciphertext'][number], index: number) => {
              const note = await Note.decrypt(
                {
                  ciphertext: ciphertext.ciphertext.map(hexStringToArray) as [
                    Uint8Array,
                    Uint8Array,
                    Uint8Array,
                    Uint8Array,
                  ],
                  blindedSenderViewingKey: hexStringToArray(ciphertext.blindedSenderViewingKey),
                  blindedReceiverViewingKey: hexStringToArray(ciphertext.blindedReceiverViewingKey),
                  annotationData: hexStringToArray(ciphertext.annotationData),
                  memo: hexStringToArray(ciphertext.memo),
                },
                viewingKey,
                spendingKey,
              );

              if (!note) return;

              if (startPosition + index >= TOTAL_LEAVES) {
                account.noteBooks[treeNumber + 1]!.notes[startPosition + index - TOTAL_LEAVES] = note;
              } else {
                account.noteBooks[treeNumber]!.notes[startPosition + index] = note;
              }
            }),
          );
        }
      } else if (parsedLog.name === 'Nullified' && !skipMerkleTree) {
        const args = parsedLog.args as unknown as NullifiedEventObject;
        const treeNumber = Number(args.treeNumber.toString());

        if (!merkleTrees[treeNumber]) {
          merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
        }

        const nullifiersFormatted = args.nullifier.map((nullifier: string) => hexStringToArray(nullifier));

        merkleTrees[treeNumber]!.nullifiers.push(...nullifiersFormatted);
      }
    }

    if (!skipMerkleTree) {
      for (const tree of merkleTrees) {
        if (tree) {
          await tree.rebuildSparseTree();
        }
      }
    }

    const maxBlock = logs.reduce(
      (acc, log) => (acc === undefined ? log.blockNumber : Math.max(acc, log.blockNumber)),
      latestSyncedBlock,
    );

    latestSyncedBlock = maxBlock;
    await saveState();
  };

  const getMerkleRoot = (treeIndex: number): string => {
    if (!merkleTrees[treeIndex]) {
      throw new Error(`Tree ${treeIndex} not initialized`);
    }

    return ByteUtils.hexlify(merkleTrees[treeIndex]!.root, true);
  };

  const getLatestMerkleRoot = (): string => {
    const latestTree = merkleTrees.filter((t) => t).pop();

    if (!latestTree) {
      throw new Error('No trees initialized');
    }

    return ByteUtils.hexlify(latestTree.root, true);
  };

  return {
    chainId,
    provider,
    getMerkleTrees: serializeTrees,
    getMerkleRoot,
    getLatestMerkleRoot,
    registerAccount: (account: RailgunIndexerAccountHandle) => {
      accounts.add(account);
    },
    unregisterAccount: (account: RailgunIndexerAccountHandle) => {
      accounts.delete(account);
    },
    hasAccount: (account: RailgunIndexerAccountHandle) => accounts.has(account),
    getAccounts: () => Array.from(accounts),
    clear: () => accounts.clear(),
    fetchLogs,
    processLogs,
    syncRange: async (
      startBlock: number,
      endBlock: number,
      options?: { logs?: GetAllLogsOptions; process?: ProcessLogsOptions }
    ) => {
      const logs = await fetchLogs(startBlock, endBlock, options?.logs);

      await processLogs(logs, options?.process);

      return logs;
    },
    sync: async (options?: { logs?: GetAllLogsOptions; process?: ProcessLogsOptions }) => {
      const startBlock = (latestSyncedBlock ?? network.GLOBAL_START_BLOCK - 1) + 1;
      const currentBlock = await provider.getBlockNumber();

      if (startBlock <= currentBlock) {
        await fetchLogs(startBlock, currentBlock, options?.logs).then((logs) =>
          processLogs(logs, options?.process),
        );
      }
    },
    dumpState: () => ({
      merkleTrees: serializeTrees(),
      latestSyncedBlock,
    }),
    loadState: async (snapshot: RailgunIndexerSnapshot) => {
      for (let i = 0; i < snapshot.merkleTrees.length; i++) {
        const tree = await MerkleTree.createTree(i);

        tree.tree = snapshot.merkleTrees[i]!.tree.map((level: string[]) => level.map(hexStringToArray));
        tree.nullifiers = snapshot.merkleTrees[i]!.nullifiers.map(hexStringToArray);
        merkleTrees[i] = tree;
      }
      latestSyncedBlock = snapshot.latestSyncedBlock;
      await saveState();
    },
    getLatestSyncedBlock: () => latestSyncedBlock,
  };
};

