/**
 * T056 (US6 AC-2): once a ragequit mines, the ASP event snapshot carries the
 * Ragequit event; the next sync flips the note ACTIVE → EXITED through the SDK's
 * real `processRagequitEvents` reconciliation, and the note drops out of the
 * spendable balance and the default note list (mine-then-status model, C12 —
 * nothing was marked at prepare/broadcast time).
 */
import type { Address } from "viem";
import { numberToHex, pad } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { chainWithLogs, mintOwnedNoteLog } from "../utils/mock-chain";
import { createMockHost } from "../utils/mock-host";
import {
    createMockAsp,
    createMockEntrypoint,
    createMockProofService,
    createMockRelayer,
} from "../utils/mock-services";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const CHAIN_ID = 11155111n;

/** Offline plugin params over the caller's mock ASP (kept for label-status control). */
function paramsWith(asp: ReturnType<typeof createMockAsp>): PPv2PluginParameters {
    return {
        chainId: CHAIN_ID,
        ownerAddress: OWNER,
        asp: { baseUrl: "https://asp.mock" },
        relayers: [],
        artifacts: {
            gatewayUrls: ["https://ipfs.mock/ipfs"],
            manifest: {
                transact_1x1: {
                    wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
                    provingKey: "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
                    verificationKey: "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
                },
            },
        },
        factories: {
            aspClient: asp,
            aspDataProvider: asp,
            relayerInteractor: createMockRelayer(),
            proofService: createMockProofService(),
            entrypointInteractor: createMockEntrypoint(),
        },
    };
}

describe("ragequit exit reconciliation (T056/US6 AC-2)", () => {
    it("flips the note to exited and excludes it from balance after the ragequit mines", async () => {
        const asp = createMockAsp();
        const bare = createMockHost();
        const minted = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
            blockNumber: 1n,
        });

        const rig = createMockHost({
            rpc: chainWithLogs([minted.log]),
            blockNumber: 100n,
        });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
            "0x0",
        );

        const plugin = await createPPv2Plugin(rig.host, paramsWith(asp));

        // Before the ragequit mines: discovered, approved, spendable.
        const before = await plugin.balance(undefined);

        expect(before.find((b) => b.tag === "spendable")?.amount).toBe(1000n);

        // The ragequit tx mines at block 101: the ASP snapshot now carries the
        // Ragequit event for this commitment.
        asp.snapshot.ragequits.push({
            txHash: pad("0x7a9e"),
            logIndex: 0,
            ragequitter: OWNER,
            withdrawnValue: minted.value,
            commitment: minted.commitment,
            nullifierHash: pad("0x0"),
            label: minted.label,
            blockNumber: numberToHex(101n),
            blockTimestamp: "1970-01-01T00:00:01Z",
            asset: NATIVE,
        });
        asp.snapshot.snapshotBlockNumber = numberToHex(102n);
        rig.setBlockNumber(102n);

        // Next read reconciles: EXITED, no spendable balance, hidden by default.
        const after = await plugin.balance(undefined);

        expect(after.find((b) => b.tag === "spendable")?.amount ?? 0n).toBe(0n);

        expect(await plugin.notes()).toHaveLength(0);

        // Still visible (auditably) when spent/exited notes are requested.
        const all = await plugin.notes(undefined, true);

        expect(all).toHaveLength(1);
        expect(all[0].commitment).toBe(minted.commitment);
        expect(all[0].status).toBe("exited");
    });
});
