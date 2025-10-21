import type { BigNumberish } from 'ethers';
import type {
  CommitmentCiphertextStructOutput,
  ShieldCiphertextStructOutput,
  CommitmentPreimageStructOutput,
} from '../railgun/logic/typechain-types/contracts/logic/RailgunLogic';
import type { RailgunProvider } from '../provider';

// Base types
export type ChainId = '1' | '11155111';

export type SerializedMerkleTree = { tree: string[][]; nullifiers: string[] };

export type RailgunLog = {
  blockNumber: number;
  topics: string[];
  data: string;
  address: string;
};

export enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

// Event types
export interface TransactEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  hash: string[];
  ciphertext: CommitmentCiphertextStructOutput[];
}

export interface ShieldEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  commitments: CommitmentPreimageStructOutput[];
  shieldCiphertext: ShieldCiphertextStructOutput[];
  fees: BigNumberish[];
}

export interface NullifiedEventObject {
  treeNumber: number;
  nullifier: string[];
}

// Log processing options
export type ProcessLogsOptions = {
  skipMerkleTree?: boolean;
};

export type GetAllLogsProgress = {
  startBlock: number;
  endBlock: number;
  currentFromBlock: number;
  currentToBlock: number;
  batchSize: number;
};

export type GetAllLogsOptions = {
  maxBatchSize?: number;
  minBatchSize?: number;
  throttleMs?: number;
  reportProgress?: boolean;
  onProgress?: (progress: GetAllLogsProgress) => void;
};

// Indexer snapshot and storage
export type RailgunIndexerSnapshot = {
  merkleTrees: SerializedMerkleTree[];
  latestSyncedBlock?: number;
};

export type RailgunIndexerStorage = {
  load: () => Promise<RailgunIndexerSnapshot | undefined>;
  save: (snapshot: RailgunIndexerSnapshot) => Promise<void>;
};

// Account handle types for indexer
export type IndexerAccountKeys = {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
};

export type IndexerNoteBook = {
  serialize: () => import('../railgun/logic/logic/note').SerializedNoteData[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBalance: (...args: any[]) => Promise<bigint>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUnspentNotes: (...args: any[]) => Promise<any[]>;
};

export type RailgunIndexerAccountHandle = {
  noteBooks: IndexerNoteBook[];
  getKeys: () => Promise<IndexerAccountKeys>;
};

// Main indexer type
export type RailgunIndexer = {
  readonly chainId: ChainId;
  readonly provider: RailgunProvider;
  getMerkleTrees: () => SerializedMerkleTree[];
  getMerkleRoot: (treeIndex: number) => string;
  getLatestMerkleRoot: () => string;
  registerAccount: (account: RailgunIndexerAccountHandle) => void;
  unregisterAccount: (account: RailgunIndexerAccountHandle) => void;
  hasAccount: (account: RailgunIndexerAccountHandle) => boolean;
  getAccounts: () => RailgunIndexerAccountHandle[];
  clear: () => void;
  fetchLogs: (
    startBlock: number,
    endBlock: number,
    options?: GetAllLogsOptions,
  ) => Promise<RailgunLog[]>;
  processLogs: (logs: RailgunLog[], options?: ProcessLogsOptions) => Promise<void>;
  syncRange: (
    startBlock: number,
    endBlock: number,
    options?: { logs?: GetAllLogsOptions; process?: ProcessLogsOptions },
  ) => Promise<RailgunLog[]>;
  sync: (options?: { logs?: GetAllLogsOptions; process?: ProcessLogsOptions }) => Promise<void>;
  dumpState: () => RailgunIndexerSnapshot;
  loadState: (snapshot: RailgunIndexerSnapshot) => Promise<void>;
  getLatestSyncedBlock: () => number | undefined;
};

export type CreateRailgunIndexerOptions = {
  chainId: ChainId;
  provider: RailgunProvider;
  storage?: RailgunIndexerStorage;
};

