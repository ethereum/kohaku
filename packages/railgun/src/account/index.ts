import type { Note, SerializedNoteData } from '../railgun/logic/logic/note';
import type { Wallet as NoteBook } from '../railgun/logic/logic/wallet';
import type { RailgunSigner } from '../provider/provider';
import type { RailgunIndexer, SerializedMerkleTree, ChainId } from '../indexer';

// Re-exports
export { createRailgunAccount } from './factory';
export { InMemoryAccountStorage } from './storage';

// Transaction data type
export type TxData = {
  to: string;
  data: string;
  value?: bigint;
  gas?: bigint;
  gasLimit?: bigint;
  from?: string;
  nonce?: number;
  chainId?: number | bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
  type?: number | string;
};

// Relay adapt types
export type Call = {
  to: string;
  data: string;
  value: bigint | number | string;
};

export type ActionData = {
  random: string;
  requireSuccess: boolean;
  minGasLimit: bigint | number | string;
  calls: Call[];
};

// Account storage type
export type RailgunAccountStorage = {
  load: (chainId: ChainId) => Promise<SerializedNoteData[][] | undefined>;
  save: (chainId: ChainId, noteBooks: SerializedNoteData[][]) => Promise<void>;
};

export type RailgunAccountKeys = {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
};

export type MnemonicAccountCredentials = {
  mnemonic: string;
  accountIndex: number;
};

export type PrivateKeyAccountCredentials = {
  privateKey: string;
};

export type RailgunAccountCredentials =
  | MnemonicAccountCredentials
  | PrivateKeyAccountCredentials;

export type CreateRailgunAccountOptions = {
  indexer: RailgunIndexer;
  credentials: RailgunAccountCredentials;
  storage?: RailgunAccountStorage;
};

export type RailgunAccount = {
  getRailgunAddress: () => Promise<string>;
  setShieldKeySigner: (signer: RailgunSigner) => void;
  sync: () => Promise<void>;
  shield: (token: string, value: bigint) => Promise<TxData>;
  shieldNative: (value: bigint) => Promise<TxData>;
  shieldMany: (tokens: string[], values: bigint[]) => Promise<TxData>;
  transfer: (token: string, value: bigint, receiver: string) => Promise<TxData>;
  unshield: (token: string, value: bigint, receiver: string) => Promise<TxData>;
  unshieldNative: (value: bigint, receiver: string) => Promise<TxData>;
  getBalance: (token?: string) => Promise<bigint>;
  getUnspentNotes: (token: string) => Promise<Note[][]>;
  serializeState: () => SerializedNoteData[][];
  serializeTrees: () => SerializedMerkleTree[];
  getAllNotes: (treeIndex: number) => Note[];
};

export type RailgunAccountHandle = {
  noteBooks: NoteBook[];
  loadNoteBooks: (noteBooks: SerializedNoteData[][]) => Promise<void>;
  getKeys: () => Promise<RailgunAccountKeys>;
};

