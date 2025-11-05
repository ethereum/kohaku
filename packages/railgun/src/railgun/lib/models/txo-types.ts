import { TransactNote } from "../note/transact-note";
import { CommitmentType, OutputType, TokenData } from "./formatted-types";
import { POIsPerList } from "./poi-types";

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  blockNumber: number;
  spendtxid: string | false;
  nullifier: string;
  note: TransactNote;
  // POIs that created this TXO
  poisPerList: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  commitmentType: CommitmentType;
  transactCreationRailgunTxid: Optional<string>;
};

export type SentCommitment = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  note: TransactNote;
  walletSource: Optional<string>;
  outputType: Optional<OutputType>;
  isLegacyTransactNote: boolean;
  railgunTxid: Optional<string>;
  poisPerList: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  commitmentType: CommitmentType;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  tokenOutputs: TransactNote[];
  unshieldValue: bigint;
  tokenData: TokenData;
};

export type UnshieldData = {
  toAddress: string;
  value: bigint;
  tokenData: TokenData;
  allowOverride?: boolean;
};

type TXOsReceivedPOIStatusInfoShared = {
  tree: number;
  position: number;
  txid: string;
  commitment: string;
  blindedCommitment: string;
  poisPerList: Optional<POIsPerList>;
};

export type TXOsReceivedPOIStatusInfo = {
  strings: TXOsReceivedPOIStatusInfoShared;
  emojis: TXOsReceivedPOIStatusInfoShared;
};

export type TXOsSpentPOIStatusInfoShared = {
  blockNumber: number;
  txid: string;
  railgunTxid: string;
  railgunTransactionInfo: string;
  poiStatusesSpentTXOs: Optional<POIsPerList>[];
  sentCommitmentsBlinded: string;
  poiStatusesSentCommitments: Optional<POIsPerList>[];
  unshieldEventsBlinded: string;
  poiStatusesUnshieldEvents: Optional<POIsPerList>[];
  listKeysCanGenerateSpentPOIs: string[];
};

export type TXOsSpentPOIStatusInfo = {
  strings: TXOsSpentPOIStatusInfoShared;
  emojis: TXOsSpentPOIStatusInfoShared;
};

export enum WalletBalanceBucket {
  Spendable = "Spendable",
  ShieldBlocked = "ShieldBlocked",
  ShieldPending = "ShieldPending",
  ProofSubmitted = "ProofSubmitted",
  MissingInternalPOI = "MissingInternalPOI", // Change or DeFi interaction (Swap receipt)
  MissingExternalPOI = "MissingExternalPOI",
  Spent = "Spent", // ie. Unshielded To Origin
}
