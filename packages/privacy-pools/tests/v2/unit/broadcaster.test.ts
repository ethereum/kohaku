import type { PoolSession } from "@privacy-pools-v2/sdk";
import { pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createPPv2Broadcaster } from "../../../src/v2/broadcaster";
import { QuoteExpiredError, RelayerUnavailableError } from "../../../src/v2/interfaces/errors";
import type { PPv2Instance } from "../../../src/v2/interfaces/plugin.interface";
import type { PPv2PrivateOperation } from "../../../src/v2/interfaces/operations.interface";
import { registerSession } from "../../../src/v2/internal/session-registry";

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 10;

function transferOp(expiration: number): PPv2PrivateOperation {
    return {
        __type: "privateOperation",
        kind: "transfer",
        chainId: 11155111n,
        relayParams: {
            selectedQuote: { quote: { feeCommitment: { expiration } } },
        },
    } as unknown as PPv2PrivateOperation;
}

/** Register a stub session against a fresh instance and build a broadcaster for it. */
function broadcasterWith(session: Partial<PoolSession>) {
    const instance = {} as PPv2Instance;

    registerSession(instance, session as PoolSession);

    return createPPv2Broadcaster(instance);
}

describe("createPPv2Broadcaster", () => {
    it("throws for an instance not created by createPPv2Plugin", () => {
        expect(() => createPPv2Broadcaster({} as PPv2Instance)).toThrowError();
    });

    it("relays a transfer and returns txHash + serialized cold-start payload", async () => {
        const recipientNotes = [{ commitment: pad("0x01") }];
        const relayTransfer = vi.fn(async () => ({
            txReceipt: { txHash: pad("0xfeed") },
            recipientNotes,
        }));
        const b = broadcasterWith({ relayTransfer } as unknown as Partial<PoolSession>);

        const result = await b.broadcast(transferOp(FUTURE));

        expect(relayTransfer).toHaveBeenCalledOnce();
        expect(result.txHash).toBe(pad("0xfeed"));
        expect(result.coldStartPayload).toBe(JSON.stringify(recipientNotes));
    });

    it("rejects an expired quote before relaying (FR-052)", async () => {
        const relayTransfer = vi.fn(async () => ({ txReceipt: { txHash: pad("0x1") } }));
        const b = broadcasterWith({ relayTransfer } as unknown as Partial<PoolSession>);

        await expect(b.broadcast(transferOp(PAST))).rejects.toBeInstanceOf(QuoteExpiredError);
        expect(relayTransfer).not.toHaveBeenCalled();
    });

    it("maps a relayer failure to a typed error (FR-051/060)", async () => {
        const relayTransfer = vi.fn(async () => {
            const e = new Error("relayer down");

            e.name = "RelayerRejected";
            throw e;
        });
        const b = broadcasterWith({ relayTransfer } as unknown as Partial<PoolSession>);

        await expect(b.broadcast(transferOp(FUTURE))).rejects.toBeInstanceOf(RelayerUnavailableError);
    });

    it("relays a withdrawal (no cold-start payload)", async () => {
        const relayWithdraw = vi.fn(async () => ({ txHash: pad("0xbeef") }));
        const b = broadcasterWith({ relayWithdraw } as unknown as Partial<PoolSession>);
        const op = {
            __type: "privateOperation",
            kind: "withdrawal",
            chainId: 11155111n,
            relayParams: { selectedQuote: { quote: { feeCommitment: { expiration: FUTURE } } } },
        } as unknown as PPv2PrivateOperation;

        const result = await b.broadcast(op);

        expect(result.txHash).toBe(pad("0xbeef"));
        expect(result.coldStartPayload).toBe("");
    });
});
