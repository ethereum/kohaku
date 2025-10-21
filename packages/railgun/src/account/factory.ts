/* eslint-disable max-lines */
import { Wallet } from 'ethers';
import { Mnemonic } from '../railgun/lib/key-derivation/bip39';
import { deriveNodes, WalletNode } from '../railgun/lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun/lib/key-derivation/bech32';
import { Wallet as NoteBook } from '../railgun/logic/logic/wallet';
import { Note } from '../railgun/logic/logic/note';
import { EthersSignerAdapter } from '../provider/ethers-adapter';
import { derivePrivateKeyNodes, deriveShieldPrivateKey, getERC20TokenData } from '../utils/account';
import { ACCOUNT_CHAIN_ID, ACCOUNT_VERSION, ZERO_ADDRESS, E_ADDRESS } from '../config';
import { InMemoryAccountStorage } from './storage';
import {
  createShieldTx,
  createNativeShieldTx,
  createShieldTxMulti,
  prepareTransactionNotes,
} from '../tx';
import { createUnshieldTx, createNativeUnshieldTx, createPrivateTransferTx } from '../tx/unshield';
import type {
  CreateRailgunAccountOptions,
  RailgunAccount,
  RailgunAccountCredentials,
  MnemonicAccountCredentials,
  PrivateKeyAccountCredentials,
  RailgunAccountKeys,
} from './index';
import type { RailgunSigner } from '../provider/provider';
import type { MerkleTree } from '../railgun/logic/logic/merkletree';
import type { SerializedNoteData } from '../railgun/logic/logic/note';

const deriveNodesFromMnemonic = (
  credentials: MnemonicAccountCredentials,
): { spendingNode: WalletNode; viewingNode: WalletNode; signer: RailgunSigner } => {
  const { spending, viewing } = deriveNodes(credentials.mnemonic, credentials.accountIndex);
  const fallbackSigner: RailgunSigner = new EthersSignerAdapter(
    new Wallet(Mnemonic.to0xPrivateKey(credentials.mnemonic, credentials.accountIndex)),
  );

  return { spendingNode: spending, viewingNode: viewing, signer: fallbackSigner };
};

const deriveNodesFromPrivateKey = (
  credentials: PrivateKeyAccountCredentials,
): { spendingNode: WalletNode; viewingNode: WalletNode; signer: RailgunSigner } => {
  const { spendingNode, viewingNode } = derivePrivateKeyNodes(credentials.privateKey);

  return {
    spendingNode,
    viewingNode,
    signer: new EthersSignerAdapter(new Wallet(credentials.privateKey)),
  };
};

const deriveNodesFromCredentials = (
  credentials: RailgunAccountCredentials,
): { spendingNode: WalletNode; viewingNode: WalletNode; signer: RailgunSigner } => {
  if ('mnemonic' in credentials) {
    return deriveNodesFromMnemonic(credentials);
  }

  if ('privateKey' in credentials) {
    return deriveNodesFromPrivateKey(credentials);
  }

  const exhaustiveCheck: never = credentials;

  throw new Error(`Unsupported credentials shape: ${String(exhaustiveCheck)}`);
};

export const createRailgunAccount = async ({
  indexer,
  credentials,
  storage,
}: CreateRailgunAccountOptions): Promise<RailgunAccount> => {
  const { spendingNode, viewingNode, signer } = deriveNodesFromCredentials(credentials);
  const accountStorage = storage ?? new InMemoryAccountStorage();

  const noteBooks: NoteBook[] = [];
  let shieldKeySigner: RailgunSigner | undefined = signer;
  let cachedKeys: RailgunAccountKeys | undefined;
  let cachedShieldKey: Uint8Array | undefined;

  const getKeys = async (): Promise<RailgunAccountKeys> => {
    if (!cachedKeys) {
      const viewingPair = await viewingNode.getViewingKeyPair();
      const spendingPair = spendingNode.getSpendingKeyPair();

      cachedKeys = {
        viewingKey: viewingPair.privateKey,
        spendingKey: spendingPair.privateKey,
      };
    }

    return cachedKeys;
  };

  const getShieldPrivateKey = async (): Promise<Uint8Array> => {
    if (!cachedShieldKey) {
      if (!shieldKeySigner) {
        throw new Error('shield key signer not set');
      }

      cachedShieldKey = await deriveShieldPrivateKey(shieldKeySigner);
    }

    return cachedShieldKey;
  };

  const getMasterPublicKey = async (): Promise<bigint> => {
    const { pubkey: spendingPubkey } = spendingNode.getSpendingKeyPair();
    const nullifyingKey = await viewingNode.getNullifyingKey();

    return WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
  };

  const getViewingPublicKey = async (): Promise<Uint8Array> => {
    const { pubkey } = await viewingNode.getViewingKeyPair();

    return pubkey;
  };

  // Register with indexer
  const handle = {
    noteBooks,
    getKeys,
  };

  indexer.registerAccount(handle);

  // Load cached notebooks
  const cachedNotes = await accountStorage.load(indexer.chainId);

  if (cachedNotes) {
    const keys = await getKeys();

    for (let i = 0; i < cachedNotes.length; i++) {
      if (!noteBooks[i]) {
        noteBooks[i] = new NoteBook();
      }

    cachedNotes[i]!.forEach((noteData: SerializedNoteData | null, j: number) => {
      if (noteData !== null) {
        noteBooks[i]!.notes[j] = Note.fromSerializedNoteData(
          keys.spendingKey,
          keys.viewingKey,
          noteData,
        );
      }
    });
    }
  }

  const saveNoteBooks = async () => {
    await accountStorage.save(
      indexer.chainId,
      noteBooks.map((noteBook) => noteBook.serialize()),
    );
  };

  const getUnspentNotes = async (token: string): Promise<Note[][]> => {
    const tokenData = getERC20TokenData(token);
    const noteCollections: Note[][] = [];
    const trees = indexer.getMerkleTrees();

    for (let i = 0; i < trees.length; i++) {
      if (!noteBooks[i]) {
        noteCollections.push([]);
        continue;
      }

      // Reconstruct merkle tree with nullifiers
      const { MerkleTree: MT } = await import('../railgun/logic/logic/merkletree');
      const { hexStringToArray: hexToArr } = await import('../railgun/logic/global/bytes');
      const tree = await MT.createTree(i);

      tree.tree = trees[i]!.tree.map((level: string[]) =>
        level.map((leaf: string) => hexToArr(leaf)),
      );
      tree.nullifiers = trees[i]!.nullifiers.map((nullifier: string) =>
        hexToArr(nullifier),
      );

      const notes = await noteBooks[i]!.getUnspentNotes(tree, tokenData);

      noteCollections.push(notes);
    }

    return noteCollections;
  };

  const getBalance = async (token?: string): Promise<bigint> => {
    const normalizedToken =
      token === ZERO_ADDRESS || token === E_ADDRESS || !token
        ? (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!.WETH
        : token;
    const tokenData = getERC20TokenData(normalizedToken);
    let total = 0n;
    const trees = indexer.getMerkleTrees();

    for (let i = 0; i < trees.length; i++) {
      if (!noteBooks[i]) continue;

      // Reconstruct merkle tree with nullifiers
      const { MerkleTree: MT } = await import('../railgun/logic/logic/merkletree');
      const { hexStringToArray: hexToArr } = await import('../railgun/logic/global/bytes');
      const tree = await MT.createTree(i);

      tree.tree = trees[i]!.tree.map((level: string[]) =>
        level.map((leaf: string) => hexToArr(leaf)),
      );
      tree.nullifiers = trees[i]!.nullifiers.map((nullifier: string) =>
        hexToArr(nullifier),
      );

      const balance = await noteBooks[i]!.getBalance(tree, tokenData);

      total += balance;
    }

    await saveNoteBooks();

    return total;
  };

  return {
    getRailgunAddress: async () => {
      const masterPublicKey = await getMasterPublicKey();
      const viewingPublicKey = await getViewingPublicKey();

      return encodeAddress({
        masterPublicKey,
        viewingPublicKey,
        chain: ACCOUNT_CHAIN_ID,
        version: ACCOUNT_VERSION,
      });
    },
    setShieldKeySigner: (signer: RailgunSigner) => {
      shieldKeySigner = signer;
      cachedShieldKey = undefined;
    },
    sync: async () => {
      await indexer.sync();
      await saveNoteBooks();
    },
    shield: async (token: string, value: bigint) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const masterPublicKey = await getMasterPublicKey();
      const shieldPrivateKey = await getShieldPrivateKey();
      const viewingPubkey = await getViewingPublicKey();

      return createShieldTx(networkConfig, masterPublicKey, shieldPrivateKey, viewingPubkey, token, value);
    },
    shieldNative: async (value: bigint) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const masterPublicKey = await getMasterPublicKey();
      const shieldPrivateKey = await getShieldPrivateKey();
      const viewingPubkey = await getViewingPublicKey();

      return createNativeShieldTx(networkConfig, masterPublicKey, shieldPrivateKey, viewingPubkey, value);
    },
    shieldMany: async (tokens: string[], values: bigint[]) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const masterPublicKey = await getMasterPublicKey();
      const shieldPrivateKey = await getShieldPrivateKey();
      const viewingPubkey = await getViewingPublicKey();

      return createShieldTxMulti(networkConfig, masterPublicKey, shieldPrivateKey, viewingPubkey, tokens, values);
    },
    transfer: async (token: string, value: bigint, receiver: string) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const keys = await getKeys();
      const unspentNotes = await getUnspentNotes(token);
      const trees = indexer.getMerkleTrees();

      // Rebuild actual merkle trees from serialized data
      const merkleTrees: MerkleTree[] = [];
      const { MerkleTree: MT } = await import('../railgun/logic/logic/merkletree');
      const { hexStringToArray: hexToArr } = await import('../railgun/logic/global/bytes');

      for (let i = 0; i < trees.length; i++) {
        const tree = await MT.createTree(i);

        tree.tree = trees[i]!.tree.map((level: string[]) =>
          level.map((leaf: string) => hexToArr(leaf)),
        );
        tree.nullifiers = trees[i]!.nullifiers.map((nullifier: string) =>
          hexToArr(nullifier),
        );
        merkleTrees[i] = tree;
      }

      const { notesIn, notesOut } = await prepareTransactionNotes(
        merkleTrees,
        noteBooks,
        unspentNotes,
        keys.spendingKey,
        keys.viewingKey,
        token,
        value,
        receiver,
        false,
      );

      return createPrivateTransferTx(networkConfig, merkleTrees, notesIn, notesOut, 1n);
    },
    unshield: async (token: string, value: bigint, receiver: string) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const keys = await getKeys();
      const unspentNotes = await getUnspentNotes(token);
      const trees = indexer.getMerkleTrees();

      // Rebuild actual merkle trees from serialized data
      const merkleTrees: MerkleTree[] = [];
      const { MerkleTree: MT } = await import('../railgun/logic/logic/merkletree');
      const { hexStringToArray: hexToArr } = await import('../railgun/logic/global/bytes');

      for (let i = 0; i < trees.length; i++) {
        const tree = await MT.createTree(i);

        tree.tree = trees[i]!.tree.map((level: string[]) =>
          level.map((leaf: string) => hexToArr(leaf)),
        );
        tree.nullifiers = trees[i]!.nullifiers.map((nullifier: string) =>
          hexToArr(nullifier),
        );
        merkleTrees[i] = tree;
      }

      const { notesIn, notesOut } = await prepareTransactionNotes(
        merkleTrees,
        noteBooks,
        unspentNotes,
        keys.spendingKey,
        keys.viewingKey,
        token,
        value,
        receiver,
        false,
      );

      return createUnshieldTx(networkConfig, merkleTrees, notesIn, notesOut, 1n);
    },
    unshieldNative: async (value: bigint, receiver: string) => {
      const networkConfig = (await import('../config')).RAILGUN_CONFIG_BY_CHAIN_ID[indexer.chainId]!;
      const keys = await getKeys();
      const unspentNotes = await getUnspentNotes(networkConfig.WETH);
      const trees = indexer.getMerkleTrees();

      // Rebuild actual merkle trees from serialized data
      const merkleTrees: MerkleTree[] = [];
      const { MerkleTree: MT } = await import('../railgun/logic/logic/merkletree');
      const { hexStringToArray: hexToArr } = await import('../railgun/logic/global/bytes');

      for (let i = 0; i < trees.length; i++) {
        const tree = await MT.createTree(i);

        tree.tree = trees[i]!.tree.map((level: string[]) =>
          level.map((leaf: string) => hexToArr(leaf)),
        );
        tree.nullifiers = trees[i]!.nullifiers.map((nullifier: string) =>
          hexToArr(nullifier),
        );
        merkleTrees[i] = tree;
      }

      const { notesIn, notesOut, nullifiers } = await prepareTransactionNotes(
        merkleTrees,
        noteBooks,
        unspentNotes,
        keys.spendingKey,
        keys.viewingKey,
        networkConfig.WETH,
        value,
        networkConfig.RELAY_ADAPT_ADDRESS,
        true,
      );

      return createNativeUnshieldTx(networkConfig, merkleTrees, notesIn, notesOut, nullifiers, receiver, 1n);
    },
    getBalance,
    getUnspentNotes,
    serializeState: () => noteBooks.map((noteBook) => noteBook.serialize()),
    serializeTrees: () => indexer.getMerkleTrees(),
    getAllNotes: (treeIndex: number) => {
      if (!noteBooks[treeIndex]) {
        throw new Error('tree index DNE');
      }

      return noteBooks[treeIndex]!.notes;
    },
  };
};

