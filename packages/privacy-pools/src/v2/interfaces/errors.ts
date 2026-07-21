import { PluginError } from "@kohaku-eth/plugins";
import type { Hex } from "@0xbow-io/privacy-pools-v2-sdk";

// NOTE: SDK error classes are matched by their `.name` string, not `instanceof`:
// the SDK declares them in its `.d.ts` but does not re-export them from its
// runtime bundle, so importing them as values yields `undefined`. Every SDK
// error sets `this.name = "<ClassName>"`, so name matching is reliable. (DEP-1.)

/**
 * Base for Privacy Pools v2 plugin errors with no matching `@kohaku-eth/plugins`
 * type. No raw SDK exception crosses the plugin boundary (FR-060).
 */
export abstract class PPv2Error extends PluginError {}

/** transfer/unshield attempted before the account is registered on-chain (FR-026, INV-8). */
export class NotRegisteredError extends PPv2Error {
    /** Fixed message pointing the caller at `prepareRegisterKeystore()`. */
    constructor() {
        super("Account is not registered. Run prepareRegisterKeystore() first.");
    }
}

/** Registration requested for an account that is already registered on-chain (US5). */
export class AlreadyRegisteredError extends PPv2Error {
    /** Fixed message — registration is a no-op to skip, not to retry. */
    constructor() {
        super("Account is already registered on-chain; no registration needed.");
    }
}

/** No single label covers amount + fee; carries the per-label breakdown (FR-023, INV-5). */
export class LabelFragmentationError extends PPv2Error {
    /** @param perLabel - each label's 4-note spendable total, for wallet guidance. */
    constructor(
        public readonly required: bigint,
        public readonly perLabel: ReadonlyArray<{ label: Hex; spendable: bigint }>,
    ) {
        super(
            `No single label covers ${required}. Per-label spendable: ` +
                perLabel.map((l) => `${l.label}=${l.spendable}`).join(", "),
        );
    }
}

/** Relayer fee commitment expired between prepare and broadcast (FR-052). */
export class QuoteExpiredError extends PPv2Error {
    /** Fixed message telling the wallet to re-prepare the operation. */
    constructor() {
        super("Relayer fee commitment has expired. Re-prepare the operation.");
    }
}

/**
 * No verified circuit artifact could be produced (FR-040): every gateway's
 * bytes failed the pinned-digest check or could not be fetched. The SDK
 * aggregates per-gateway digest mismatches into `CircuitArtifactLoadFailed`
 * (both map here) — the artifact layer fails closed either way.
 */
export class ArtifactIntegrityError extends PPv2Error {
    /** @param message - per-gateway failure detail from the SDK, when available. */
    constructor(message = "Circuit artifact failed integrity verification.") {
        super(message);
    }
}

/** Persisted state was unreadable/corrupt; fail closed, never silent-reset (Principle I). */
export class StorageCorruptionError extends PPv2Error {
    /** @param key - the (un-prefixed) storage key whose value was unreadable. */
    constructor(
        public readonly key: string,
        public override readonly cause?: unknown,
    ) {
        super(`Corrupt stored value at key: ${key}`);
    }
}

/** Chain-event sync/discovery failed (RPC or ASP unreachable); retryable. */
export class SyncFailedError extends PPv2Error {
    /** Carries the underlying RPC/ASP failure as `cause`. */
    constructor(
        message = "Note sync failed; retry when the RPC/ASP is reachable.",
        public override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/** Relay submission failed at the relayer/network layer (FR-051). */
export class RelayerUnavailableError extends PPv2Error {
    /** Carries the relayer/network failure as `cause`. */
    constructor(
        message = "Relayer is unavailable or rejected the request.",
        public override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/**
 * Operation parameters failed SDK validation — including the withdraw
 * anti-theft checks (relayer quote's payout routing/fee mismatch). Nothing was
 * sent; do NOT retry the same quote — it may be malformed or malicious.
 */
export class InvalidOperationError extends PPv2Error {
    constructor(
        message = "Operation parameters failed validation (possibly a malformed or malicious relayer quote).",
        public override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/**
 * Selected inputs cannot cover the amount and/or the relayer fee (FR-052).
 * Needs more spendable value — distinct from the retryable relayer errors.
 */
export class InsufficientFundsError extends PPv2Error {
    /** Carries the SDK's value-shortfall error as `cause`. */
    constructor(
        message = "Insufficient funds for this operation.",
        public override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/** An account import blob did not match this instance's owner/chain (FR-033). */
export class AccountImportMismatchError extends PPv2Error {
    /** Fixed message — the blob is unusable on this instance, not retryable. */
    constructor() {
        super("Account export does not match this instance's owner/chain.");
    }
}

/**
 * Scaffolding for a plugin verb not yet implemented (FR-060). Temporary —
 * each throw is replaced as its user-story task lands.
 */
export class NotImplementedError extends PPv2Error {
    /** @param task - the spec task that will replace this stub. */
    constructor(method: string, task: string) {
        super(`${method} is not implemented yet (pending ${task}).`);
    }
}

/**
 * Normalize an SDK (or unknown) error thrown inside a plugin method into a typed
 * plugin error. Known SDK error classes map to their plugin equivalents; anything
 * else is wrapped so no raw SDK exception escapes (FR-060).
 */
export function mapSdkError(err: unknown): PluginError {
    if (err instanceof PluginError) return err;

    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);

    switch (name) {
        case "KeystoreNotRegistered":
            return new NotRegisteredError();
        case "AlreadyRegistered":
            return new AlreadyRegisteredError();
        case "AccountExportMismatch":
            return new AccountImportMismatchError();
        case "FeeCommitmentExpired":
            return new QuoteExpiredError();
        case "CircuitArtifactMultihashMismatch":
        case "CIDDigestMismatch":
        case "CircuitArtifactLoadFailed":
            return new ArtifactIntegrityError(message);
        case "InvalidStorageStateError":
            return new StorageCorruptionError("<sdk-state>", err);
        // TransactNoteNotActive = an input note is no longer ACTIVE at proving
        // time: stale local state (e.g. a concurrent spend) — resync and retry.
        case "NoteDiscoveryScanFailed":
        case "RPCInteractorBaseError":
        case "GetBlockNumberFailed":
        case "EventReadError":
        case "TransactNoteNotActive":
            return new SyncFailedError(message, err);
        case "InvalidTransactParams":
            return new InvalidOperationError(message, err);
        case "RelayerRejected":
        case "RelayerRequestFailed":
        case "RelayTimeout":
            return new RelayerUnavailableError(message, err);
        case "InsufficientTransactValue":
        case "InsufficientChangeValueForFee":
            return new InsufficientFundsError(message, err);
        default:
            return new UnexpectedSdkError(err);
    }
}

/** Fallback wrapper for an SDK error with no specific mapping (FR-060). */
export class UnexpectedSdkError extends PPv2Error {
    /** Preserves the original error as `cause`; its message passes through. */
    constructor(public override readonly cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
    }
}
