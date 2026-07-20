import { InsufficientBalanceError, PluginError } from "@kohaku-eth/plugins";
import { describe, expect, it } from "vitest";
import {
    AccountImportMismatchError,
    AlreadyRegisteredError,
    ArtifactIntegrityError,
    InsufficientFundsError,
    mapSdkError,
    NotRegisteredError,
    QuoteExpiredError,
    RelayerUnavailableError,
    StorageCorruptionError,
    UnexpectedSdkError,
} from "../../../src/v2/interfaces/errors";

/** An error shaped like the SDK's (name-tagged; classes aren't runtime-exported). */
function sdkError(name: string, message = name): Error {
    const e = new Error(message);

    e.name = name;

    return e;
}

describe("mapSdkError (FR-060)", () => {
    it("maps known SDK error names to typed plugin errors", () => {
        expect(mapSdkError(sdkError("KeystoreNotRegistered"))).toBeInstanceOf(NotRegisteredError);
        expect(mapSdkError(sdkError("AlreadyRegistered"))).toBeInstanceOf(AlreadyRegisteredError);
        expect(mapSdkError(sdkError("AccountExportMismatch"))).toBeInstanceOf(
            AccountImportMismatchError,
        );
        expect(mapSdkError(sdkError("FeeCommitmentExpired"))).toBeInstanceOf(QuoteExpiredError);
        expect(mapSdkError(sdkError("CircuitArtifactMultihashMismatch"))).toBeInstanceOf(
            ArtifactIntegrityError,
        );
        expect(mapSdkError(sdkError("CIDDigestMismatch"))).toBeInstanceOf(ArtifactIntegrityError);
        expect(mapSdkError(sdkError("InvalidStorageStateError"))).toBeInstanceOf(
            StorageCorruptionError,
        );

        for (const relayName of ["RelayerRejected", "RelayerRequestFailed", "RelayTimeout"]) {
            expect(mapSdkError(sdkError(relayName))).toBeInstanceOf(RelayerUnavailableError);
        }

        // Funds shortfalls are terminal, not relayer-retryable: they must NOT be
        // RelayerUnavailableError or wallet retry loops would spin forever.
        for (const fundsName of ["InsufficientTransactValue", "InsufficientChangeValueForFee"]) {
            const mapped = mapSdkError(sdkError(fundsName));

            expect(mapped).toBeInstanceOf(InsufficientFundsError);
            expect(mapped).not.toBeInstanceOf(RelayerUnavailableError);
        }
    });

    it("passes through existing PluginErrors untouched", () => {
        const original = new InsufficientBalanceError({ __type: "native" }, 2n, 1n);

        expect(mapSdkError(original)).toBe(original);
    });

    it("wraps unknown errors so nothing raw escapes", () => {
        const mapped = mapSdkError(sdkError("SomethingNovel", "boom"));

        expect(mapped).toBeInstanceOf(UnexpectedSdkError);
        expect(mapped).toBeInstanceOf(PluginError);
        expect(mapped.message).toBe("boom");

        const nonError = mapSdkError("string failure");

        expect(nonError).toBeInstanceOf(UnexpectedSdkError);
    });
});
