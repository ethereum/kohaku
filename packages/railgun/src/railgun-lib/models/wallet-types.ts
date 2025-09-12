import { UnshieldStoredEvent } from './event-types';
import { OutputType, TokenData } from './formatted-types';
import { TXIDVersion } from './poi-types';
import { TXO, WalletBalanceBucket } from './txo-types';

export type WalletDetailsMap = Partial<Record<TXIDVersion, WalletDetails>>;

export type WalletDetails = {
  treeScannedHeights: number[];
  creationTree: Optional<number>;
  creationTreeHeight: Optional<number>;
};

export type TreeBalance = {
  balance: bigint;
  tokenData: TokenData;
  utxos: TXO[];
};

export type TokenBalancesAllTxidVersions = {
  [txidVersion: string]: TokenBalances;
};

export type TokenBalances = {
  [tokenHash: string]: TreeBalance;
};

export type TotalBalancesByTreeNumber = {
  [tree: string]: TreeBalance[];
};

export type AddressKeys = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
};

export type WalletData = {
  mnemonic: string;
  index: number;
  creationBlockNumbers: Optional<number[][]>;
};

export type ViewOnlyWalletData = {
  shareableViewingKey: string;
  creationBlockNumbers: Optional<number[][]>;
};

export type ShareableViewingKeyData = {
  vpriv: string; // viewingPrivateKey
  spub: string; // spendingPublicKey
};

export type TransactionHistoryTokenAmount = {
  tokenHash: string;
  tokenData: TokenData;
  amount: bigint;
  outputType?: OutputType;
  walletSource?: string;
  memoText: Optional<string>;
  hasValidPOIForActiveLists: boolean;
};
export type TransactionHistoryTransferTokenAmount = TransactionHistoryTokenAmount & {
  recipientAddress: string;
};
export type TransactionHistoryUnshieldTokenAmount = TransactionHistoryTransferTokenAmount & {
  unshieldFee: string;
};
export type TransactionHistoryReceiveTokenAmount = TransactionHistoryTokenAmount & {
  senderAddress: Optional<string>;
  shieldFee: Optional<string>;
  balanceBucket: WalletBalanceBucket;
};
export type TransactionHistoryEntryReceived = {
  txidVersion: TXIDVersion;
  txid: string;
  timestamp: Optional<number>;
  blockNumber: Optional<number>;
  receiveTokenAmounts: TransactionHistoryReceiveTokenAmount[];
};
export type TransactionHistoryEntrySpent = {
  txidVersion: TXIDVersion;
  txid: string;
  timestamp: Optional<number>;
  blockNumber: Optional<number>;
  transferTokenAmounts: TransactionHistoryTransferTokenAmount[];
  changeTokenAmounts: TransactionHistoryTokenAmount[];
  broadcasterFeeTokenAmount?: TransactionHistoryTokenAmount;
  unshieldTokenAmounts: TransactionHistoryUnshieldTokenAmount[];
  version: TransactionHistoryItemVersion;
};
export type TransactionHistoryEntry = TransactionHistoryEntrySpent &
  TransactionHistoryEntryReceived;
export type TransactionHistoryEntryPreprocessSpent = {
  txid: string;
  timestamp: Optional<number>;
  blockNumber: Optional<number>;
  tokenAmounts: TransactionHistoryTokenAmount[];
  version: TransactionHistoryItemVersion;
  unshieldEvents: UnshieldStoredEvent[];
};
export enum TransactionHistoryItemVersion {
  Unknown = 0, // Receive note only: noteAnnotationData metadata not possible
  Legacy = 1, // No noteAnnotationData on spent notes
  UpdatedAug2022 = 2, // Adds noteAnnotationData for spent notes (outputType)
  UpdatedNov2022 = 3, // Adds unshields and possible sender for received notes
}
