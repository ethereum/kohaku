import { PluginError } from "@kohaku-eth/plugins";
import type { Hex } from "@privacy-pools-v2/sdk";

// NOTE: SDK error classes are matched by their `.name` string rather than
// `instanceof`. The unpublished SDK build (`@privacy-pools-v2/sdk` 0.0.0) declares
// these classes in its `.d.ts` but does NOT re-export them from its runtime JS
// bundle, so importing them as values yields `undefined` and `instanceof` throws.
// Every SDK error sets `this.name = "<ClassName>"`, so name matching is reliable
// and avoids depending on the broken runtime exports. (Flag for DEP-1.)

/**
 * Base for Privacy Pools v2 plugin errors with no matching `@kohaku-eth/plugins`
 * type. No raw SDK exception may cross the plugin boundary (FR-060); everything
 * is normalized to a `PluginError` subclass so the wallet can classify failures.
 */
export abstract class PPv2Error extends PluginError {}

/** transfer/unshield attempted before the account is registered on-chain (FR-026, INV-8). */
export class NotRegisteredError extends PPv2Error {
    constructor() {
        super("Account is not registered. Run prepareRegisterKeystore() first.");
    }
}

/** Registration requested for an account that is already registered on-chain (US5). */
export class AlreadyRegisteredError extends PPv2Error {
    constructor() {
        super("Account is already registered on-chain; no registration needed.");
    }
}

/** No single label covers amount + fee; carries the per-label breakdown (FR-023, INV-5). */
export class LabelFragmentationError extends PPv2Error {
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
    constructor() {
        super("Relayer fee commitment has expired. Re-prepare the operation.");
    }
}

/** A fetched circuit artifact failed its pinned-digest check (FR-040). */
export class ArtifactIntegrityError extends PPv2Error {
    constructor(message = "Circuit artifact failed integrity verification.") {
        super(message);
    }
}

/** Persisted state was unreadable/corrupt; fail closed, never silent-reset (Principle I). */
export class StorageCorruptionError extends PPv2Error {
    constructor(
        public readonly key: string,
        public override readonly cause?: unknown,
    ) {
        super(`Corrupt stored value at key: ${key}`);
    }
}

/** Relay submission failed at the relayer/network layer (FR-051). */
export class RelayerUnavailableError extends PPv2Error {
    constructor(
        message = "Relayer is unavailable or rejected the request.",
        public override readonly cause?: unknown,
    ) {
        super(message);
    }
}

/** An account import blob did not match this instance's owner/chain (FR-033). */
export class AccountImportMismatchError extends PPv2Error {
    constructor() {
        super("Account export does not match this instance's owner/chain.");
    }
}

/**
 * Scaffolding for a plugin verb not yet implemented. Temporary — each throw is
 * replaced as its user-story task lands; typed so it never crosses the boundary
 * as a raw error (FR-060).
 */
export class NotImplementedError extends PPv2Error {
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
            return new ArtifactIntegrityError(message);
        case "InvalidStorageStateError":
            return new StorageCorruptionError("<sdk-state>", err);
        case "RelayerRejected":
        case "RelayerRequestFailed":
        case "RelayTimeout":
        case "InsufficientTransactValue":
        case "InsufficientChangeValueForFee":
            return new RelayerUnavailableError(message, err);
        default:
            return new UnexpectedSdkError(err);
    }
}

/** Fallback wrapper for an SDK error with no specific mapping (FR-060). */
export class UnexpectedSdkError extends PPv2Error {
    constructor(public override readonly cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
    }
}
