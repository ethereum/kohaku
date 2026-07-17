import type { PrivateOperation, PublicOperation } from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";
import type {
    ExecuteWithdrawRelayerParams,
    Hex,
    NoteStatus,
    RelayTransferParams,
} from "@0xbow-io/privacy-pools-v2-sdk";
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
 * Carries the exact SDK relay argument (the single chosen relayer option, including
 * its live fee commitment) so the broadcaster just forwards it to the shared
 * session's relay path — which re-proves with the quoted fee, submits, and persists
 * note updates itself (FR-053). Routing is bound into the proof (INV-7). Discriminated
 * on `kind`; the fee-commitment expiry lives at
 * `relayParams.selectedQuote.quote.feeCommitment.expiration`.
 */
export type PPv2PrivateOperation =
    | (PrivateOperation & {
          kind: "transfer";
          chainId: bigint;
          relayParams: RelayTransferParams;
      })
    | (PrivateOperation & {
          kind: "withdrawal";
          chainId: bigint;
          relayParams: ExecuteWithdrawRelayerParams;
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
