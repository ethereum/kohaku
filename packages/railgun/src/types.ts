export type Hex = `0x${string}`;
export type RailgunAddress = `0zk${string}`;

export type PoiStatus =
  | "Valid"
  | "ProofSubmitted"
  | "Missing"
  | "ShieldBlocked"
  | "Unavailable";

export interface RailgunChain {
  chainId: bigint;
  deploymentBlock: bigint;
  poiStartBlock: bigint;
  railgunSmartWallet: Hex;
  wrappedBaseToken: Hex;
  unshieldFeeBps: number;
  subsquidEndpoint: string;
  poiEndpoint: string;
}

export interface RailgunBalance {
  asset: string;
  amount: bigint;
  poiStatus: PoiStatus | null;
}

export interface RailgunNote extends RailgunBalance {
  treeNumber: number;
  leafIndex: number;
  blindedCommitment: Hex;
  commitmentType: "Shield" | "Transact" | "Unshield";
  memo: string;
}

export interface PendingPoi {
  txid: string;
  utxoTreeIn: number;
  inputs: number;
  outputs: number;
  hasUnshield: boolean;
  listKeys: string[];
}

export interface PoiProcessReport {
  pendingBefore: number;
  submitted: string[];
  waitingForTxid: string[];
  waitingForInputPoi: string[];
  failed: Array<{ txid: string; error: string }>;
  pendingAfter: number;
}

export type ExecutionCall = {
  target: Hex;
  value: bigint;
  data: Hex;
};

export type ShieldEntry =
  | { kind: "erc20"; token: Hex; amount: bigint }
  | { kind: "native"; amount: bigint };

export interface TransactionCall {
  to: Hex;
  data: Hex;
  value: bigint;
}

/** Rust emits the ERC-4337 JSON-RPC wire format, including hex quantities. */
export interface SignedUserOperation {
  userOp: Record<string, unknown>;
  entryPoint: Hex;
}

export interface PreparedUserOperation {
  signed: SignedUserOperation;
  userOpHash: Hex;
}

export interface RailgunOpenOptions {
  chainId: bigint;
  rpcUrl: string;
  spendingKey: Hex;
  viewingKey: Hex;
  /** New-format Rust checkpoint only. Omit to rebuild history from chain data. */
  checkpointJson?: string | null;
  /** Optional circuit source URL; the default is pinned in kohaku-rs. */
  artifactBaseUrl?: string;
  /** Store the secret checkpoint encrypted and atomically before returning. */
  persistCheckpoint: (checkpointJson: string) => Promise<void> | void;
}

export interface RailgunWorkerOpenOptions extends RailgunOpenOptions {
  /** All worker requests use this host transport. Defaults to the host fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface TransferOptions {
  recipient: RailgunAddress;
  token: Hex;
  amount: bigint;
  memo?: string;
  accountPrivateKey: Hex;
  bundlerUrl: string;
}

export interface UnshieldOptions {
  recipient: Hex;
  token: Hex;
  /** Amount the recipient should receive, before Rust adds the protocol fee. */
  amount: bigint;
  unwrapNative?: boolean;
  /** Ordered calls executed after Railgun unshield and optional WETH unwrap. */
  tailCalls?: readonly ExecutionCall[];
  accountPrivateKey: Hex;
  bundlerUrl: string;
}
