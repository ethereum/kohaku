import type { PrivateOperation, PublicOperation } from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";
import type {
    Hex,
    NoteStatus,
    PrepareTransferResult,
    PrepareWithdrawResult,
    TransferRelayerQuote,
    WithdrawalRelayerQuote,
} from "@privacy-pools-v2/sdk";
import type { PPv2AssetId } from "../mapping/assets";

/**
 * A public operation: ordered ready-to-sign transaction data the wallet's own
 * account signs and sends (shield / register / ragequit). The plugin never
 * signs or submits it (INV-1, FR-004).
 */
export type PPv2PublicOperation = PublicOperation & {
    /** approve? + deposit / register calls / ragequit, in execution order. */
    txs: TxData[];
};

/**
 * A private operation, opaque to the wallet and consumed by {@link PPv2Broadcaster}.
 * Carries the prepared SDK result plus the single relayer quote chosen at prepare
 * time. Routing is bound into the proof and never re-derived after (INV-7).
 * Discriminated on `kind`.
 */
export type PPv2PrivateOperation =
    | (PrivateOperation & {
          kind: "transfer";
          chainId: bigint;
          prepared: PrepareTransferResult;
          quote: TransferRelayerQuote;
      })
    | (PrivateOperation & {
          kind: "withdrawal";
          chainId: bigint;
          prepared: PrepareWithdrawResult;
          quote: WithdrawalRelayerQuote;
      });

/**
 * Result the broadcaster returns: the mined transaction hash plus the cold-start
 * secret payload the sender delivers out-of-band to the recipient (FR-027, FR-050).
 */
export type PPv2BroadcastResult = {
    txHash: Hex;
    /** Out-of-band secrets for a cold-start recipient; empty for withdrawals. */
    coldStartPayload: string;
};

/**
 * Per-note detail surfaced by `notes()` so a UI can explain why funds are
 * unspendable. `status` mirrors the SDK note lifecycle (lowercased); `labelState`
 * reflects association-set approval.
 */
export type PPv2Note = {
    commitment: Hex;
    asset: PPv2AssetId;
    value: bigint;
    status: Lowercase<keyof typeof NoteStatus>;
    labelState: "pending" | "approved" | "revoked";
};
