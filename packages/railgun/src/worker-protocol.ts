import type { PendingPoi, RailgunAddress, RailgunChain, RailgunOpenOptions } from "./types";

export type WorkerMethod = "chainConfig" | "deriveAddress" | "buildShieldCalls"
  | "open" | "sync" | "syncTo" | "syncHistoryTo" | "refreshPoi"
  | "processPendingPoi" | "balances" | "notes" | "prepareTransfer" | "prepareUnshield"
  | "checkpointJson" | "poiStatusPerList";

export type WorkerOpenInput = Omit<RailgunOpenOptions, "persistCheckpoint">;

export interface WalletMetadata {
  chain: RailgunChain;
  address: RailgunAddress;
  syncedBlock: bigint;
  pendingPoi: PendingPoi[];
  poiListKeys: string[];
  recoveredValidTxids: string[];
}

export interface WireError {
  name: string;
  message: string;
  errors?: WireError[];
}

export function serializeError(error: unknown): WireError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  return {
    name: error.name,
    message: error.message,
    ...(error instanceof AggregateError ? { errors: error.errors.map(serializeError) } : {}),
  };
}

export function deserializeError(error: WireError): Error {
  const result = error.errors
    ? new AggregateError(error.errors.map(deserializeError), error.message)
    : new Error(error.message);
  result.name = error.name;
  return result;
}

export type HostRequest =
  | { type: "host"; id: number; callId: number; method: "persist"; checkpoint: string }
  | { type: "host"; id: number; callId: number; method: "fetch"; url: string;
      init: { method: string; headers: [string, string][]; body?: ArrayBuffer;
        redirect: RequestRedirect; credentials: RequestCredentials } };

export interface FetchResult {
  status: number;
  statusText: string;
  headers: [string, string][];
  url: string;
  redirected: boolean;
  body: ArrayBuffer;
}

export type WorkerMessage = HostRequest
  | { type: "hostAbort"; id: number }
  | { type: "result"; id: number; value?: unknown; error?: WireError; metadata?: WalletMetadata };

export type ParentMessage =
  | { type: "call"; id: number; method: WorkerMethod; args: unknown[] }
  | { type: "hostResult"; id: number; value?: FetchResult; error?: WireError };
