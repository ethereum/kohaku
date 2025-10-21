import {
  Commitment,
  Nullifier,
  RailgunTransactionV2,
  RailgunTransactionV3,
} from './formatted-types';
import { Chain } from './engine-types';
import { POIsPerList, TXIDVersion } from './poi-types';

export enum EngineEvent {
  WalletDecryptBalancesComplete = 'decrypted-balances',
  ContractNullifierReceived = 'nullified',
  UTXOMerkletreeHistoryScanUpdate = 'utxo-merkletree-history-scan-update',
  TXIDMerkletreeHistoryScanUpdate = 'txid-merkletree-history-scan-update',
  POIProofUpdate = 'POIProofUpdate',
  UTXOScanDecryptBalancesComplete = 'UTXOScanDecryptBalancesComplete',
}

export type QuickSyncEvents = (
  txidVersion: TXIDVersion,
  chain: Chain,
  startingBlock: number,
) => Promise<AccumulatedEvents>;
export type EventsCommitmentListener = (
  txidVersion: TXIDVersion,
  events: CommitmentEvent[],
) => Promise<void>;
export type EventsNullifierListener = (
  txidVersion: TXIDVersion,
  nullifiers: Nullifier[],
) => Promise<void>;
export type EventsUnshieldListener = (
  txidVersion: TXIDVersion,
  unshields: UnshieldStoredEvent[],
) => Promise<void>;
export type EventsRailgunTransactionListenerV3 = (
  txidVersion: TXIDVersion,
  railgunTransaction: RailgunTransactionV3[],
) => Promise<void>;

export type QuickSyncRailgunTransactionsV2 = (
  chain: Chain,
  latestGraphID: Optional<string>,
) => Promise<RailgunTransactionV2[]>;

export type GetLatestValidatedRailgunTxid = (
  txidVersion: TXIDVersion,
  chain: Chain,
) => Promise<{ txidIndex: Optional<number>; merkleroot: Optional<string> }>;

export type CommitmentEvent = {
  txid: string;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
  blockNumber: number;
};

export type UnshieldStoredEvent = {
  txid: string;
  timestamp: Optional<number>;
  toAddress: string;
  tokenType: number;
  tokenAddress: string;
  tokenSubID: string;
  amount: string;
  fee: string;
  blockNumber: number;
  eventLogIndex: Optional<number>;
  railgunTxid: Optional<string>;
  poisPerList: Optional<POIsPerList>;
};

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  unshieldEvents: UnshieldStoredEvent[];
  nullifierEvents: Nullifier[];
  railgunTransactionEvents?: RailgunTransactionV3[];
};

export type WalletScannedEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
};

export type UTXOScanDecryptBalancesCompleteEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
  walletIdFilter: Optional<string[]>;
};

export type MerkletreeHistoryScanEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
  progress?: number;
  scanStatus: MerkletreeScanStatus;
};

export enum MerkletreeScanStatus {
  Started = 'Started',
  Updated = 'Updated',
  Complete = 'Complete',
  Incomplete = 'Incomplete',
}

export enum POIProofEventStatus {
  LoadingNextBatch = 'LoadingNextBatch',
  InProgress = 'InProgress',
  Error = 'Error',
  AllProofsCompleted = 'AllProofsCompleted',
}

export type POICurrentProofEventData = {
  status: POIProofEventStatus;
  txidVersion: TXIDVersion;
  chain: Chain;
  progress: number;
  listKey: string;
  txid: string;
  railgunTxid: string;
  index: number;
  totalCount: number;
  errorMsg: Optional<string>;
};
