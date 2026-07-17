import type { Note, PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { QuoteExpiredError, mapSdkError } from "./interfaces/errors";
import { getSession } from "./internal/session-registry";
import type {
    PPv2Broadcaster,
    PPv2Instance,
} from "./interfaces/plugin.interface";
import type {
    PPv2BroadcastResult,
    PPv2PrivateOperation,
} from "./interfaces/operations.interface";

/** Serialize cold-start recipient notes for out-of-band delivery (FR-027). */
function serializeColdStartPayload(recipientNotes: Note[] | undefined): string {
    return JSON.stringify(recipientNotes ?? []);
}

/**
 * Thin broadcaster over the plugin's shared {@link PoolSession}. It re-checks the
 * fee-commitment expiry (FR-052) then forwards the prepared relay option to the
 * session's relay path, which re-proves with the quoted fee, submits, and persists
 * note updates (inputs spent, change added) through the plugin-owned note manager
 * (FR-053) — so there is no manual reconciliation here. Never signs (INV-1).
 */
class SharedSessionBroadcaster implements PPv2Broadcaster {
    constructor(private readonly session: PoolSession) {}

    async broadcast(operation: PPv2PrivateOperation): Promise<PPv2BroadcastResult> {
        const expiration = operation.relayParams.selectedQuote.quote.feeCommitment.expiration;

        if (expiration * 1000 <= Date.now()) {
            throw new QuoteExpiredError();
        }

        try {
            if (operation.kind === "transfer") {
                const result = await this.session.relayTransfer(operation.relayParams);

                return {
                    txHash: result.txReceipt.txHash,
                    coldStartPayload: serializeColdStartPayload(result.recipientNotes),
                };
            }

            const receipt = await this.session.relayWithdraw(operation.relayParams);

            return { txHash: receipt.txHash, coldStartPayload: "" };
        } catch (err) {
            // Relay failure leaves inputs `active` (the SDK marks them spent only on a
            // mined relay) — nothing to roll back; surface a typed error (FR-051).
            throw mapSdkError(err);
        }
    }
}

/**
 * Construct a {@link PPv2Broadcaster} that shares the plugin instance's `PoolSession`
 * (FR-053). Both must come from the same `createPPv2Plugin` call.
 *
 * @throws {Error} if the instance was not produced by `createPPv2Plugin`.
 */
export function createPPv2Broadcaster(instance: PPv2Instance): PPv2Broadcaster {
    const session = getSession(instance);

    if (!session) {
        throw new Error(
            "createPPv2Broadcaster: instance was not created by createPPv2Plugin (no shared session).",
        );
    }

    return new SharedSessionBroadcaster(session);
}
