import { NoteStatus } from "@privacy-pools-v2/sdk";

/** How a note's value is reported to the wallet. */
export type SpendTag = "spendable" | "unspendable";

/** A note in a `spent`/`exited` terminal state is excluded from balance. */
export type NoteReport = SpendTag | "excluded";

/**
 * Map an SDK note status to its balance treatment (data-model §"Status → balance
 * tag"): `ACTIVE` is spendable; `INACTIVE`/`PENDING`/`REJECTED` are unspendable;
 * `SPENT`/`EXITED` are excluded. Exhaustive over {@link NoteStatus}.
 */
export function statusToReport(status: NoteStatus): NoteReport {
    switch (status) {
        case NoteStatus.ACTIVE:
            return "spendable";
        case NoteStatus.INACTIVE:
        case NoteStatus.PENDING:
        case NoteStatus.REJECTED:
            return "unspendable";
        case NoteStatus.SPENT:
        case NoteStatus.EXITED:
            return "excluded";
    }
}

/** Only `ACTIVE` notes contribute to spendable balance (INV-4). */
export function isSpendable(status: NoteStatus): boolean {
    return statusToReport(status) === "spendable";
}

/** Spent/exited notes are excluded from balance and default `notes()` output. */
export function isExcluded(status: NoteStatus): boolean {
    return statusToReport(status) === "excluded";
}

/** The wallet-facing lowercase status string for {@link PPv2Note}. */
export function statusLabel(status: NoteStatus): Lowercase<keyof typeof NoteStatus> {
    return status.toLowerCase() as Lowercase<keyof typeof NoteStatus>;
}

/**
 * The note's association-set label state derived from its status: a `REJECTED`
 * note's label was revoked; `INACTIVE`/`PENDING` are awaiting approval; everything
 * else (`ACTIVE`/`SPENT`/`EXITED`) had an approved label.
 */
export function labelStateFor(status: NoteStatus): "pending" | "approved" | "revoked" {
    switch (status) {
        case NoteStatus.REJECTED:
            return "revoked";
        case NoteStatus.INACTIVE:
        case NoteStatus.PENDING:
            return "pending";
        case NoteStatus.ACTIVE:
        case NoteStatus.SPENT:
        case NoteStatus.EXITED:
            return "approved";
    }
}
