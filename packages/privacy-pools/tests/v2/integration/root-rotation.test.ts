/**
 * T066 (F4): the ASP association-set root rotates between prepare and execute —
 * the relayer rejects the stale-root proof at broadcast time. The plugin-owned
 * surface under test: the rejection crosses the boundary as a typed
 * `RelayerUnavailableError` (cause preserved), and because inputs are only
 * marked spent on a MINED relay (mine-then-SPENT, C12), the SAME prepared
 * operation re-broadcasts cleanly once the relayer accepts the refreshed root —
 * that is the resync-and-retry path. The on-chain revert itself is contract
 * territory, observed in the manual Sepolia pass (T068).
 */
import type { PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createPPv2Broadcaster } from "../../../src/v2/broadcaster";
import { RelayerUnavailableError } from "../../../src/v2/interfaces/errors";
import type { PPv2Instance } from "../../../src/v2/interfaces/plugin.interface";
import type { PPv2PrivateOperation } from "../../../src/v2/interfaces/operations.interface";
import { registerSession } from "../../../src/v2/internal/session-registry";

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const OP = {
    __type: "privateOperation",
    kind: "transfer",
    chainId: 11155111n,
    relayParams: {
        selectedQuote: { quote: { feeCommitment: { expiration: FUTURE } } },
    },
} as unknown as PPv2PrivateOperation;

describe("ASP root rotation between prepare and execute (T066/F4)", () => {
    it("surfaces a typed retryable rejection; the same op relays after the root refresh", async () => {
        // Relayer behavior: rejects while its root is stale, accepts after resync.
        let rootStale = true;
        const relayTransfer = vi.fn(async () => {
            if (rootStale) {
                const e = new Error("proof verified against a rotated ASP root");

                e.name = "RelayerRejected";
                throw e;
            }

            return { txReceipt: { txHash: pad("0xfeed") }, recipientNotes: [] };
        });

        const instance = {} as PPv2Instance;

        registerSession(instance, { relayTransfer } as unknown as PoolSession);
        const broadcaster = createPPv2Broadcaster(instance);

        // Execute against the rotated root: typed error, original cause kept.
        const failure = await broadcaster.broadcast(OP).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RelayerUnavailableError);
        expect((failure as RelayerUnavailableError).cause).toMatchObject({
            name: "RelayerRejected",
        });

        // Nothing was marked spent on the failed relay (mine-then-SPENT), so the
        // wallet's retry path is simply: resync, re-broadcast the same operation.
        rootStale = false;

        const result = await broadcaster.broadcast(OP);

        expect(result.txHash).toBe(pad("0xfeed"));
        expect(relayTransfer).toHaveBeenCalledTimes(2);
    });
});
