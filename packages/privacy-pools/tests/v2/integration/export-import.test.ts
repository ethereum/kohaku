/**
 * T059 (US7 AC-2, FR-033, INV-3): a real export→import round-trip between two
 * devices. Device B's chain does NOT serve device A's note — the imported blob is
 * provably the source of that state — and B's next read continues incremental
 * sync from the imported cursor, picking up a newer on-chain note on top.
 */
import type { Address } from "viem";
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

function params(): PPv2PluginParameters {
    const asp = createMockAsp();

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

async function seedIndex(storage: ReturnType<typeof createMockHost>["host"]["storage"]) {
    await persistRevocableKeyIndex(new KohakuStorageService(storage), CHAIN_ID, OWNER, "0x0");
}

describe("account export/import across devices (T059/US7 AC-2)", () => {
    it("imports A's state into B and continues incremental sync on top of it", async () => {
        const bare = createMockHost();
        const noteA = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
            blockNumber: 1n,
        });
        const noteB = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 500n,
            blockNumber: 101n,
        });

        noteB.log.logIndex = "0x1";

        // Device A: sees only noteA, discovers it, exports.
        const devA = createMockHost({ rpc: chainWithLogs([noteA.log]), blockNumber: 100n });

        await seedIndex(devA.host.storage);
        const pluginA = await createPPv2Plugin(devA.host, params());

        expect(
            (await pluginA.balance(undefined)).find((b) => b.tag === "spendable")?.amount,
        ).toBe(1000n);

        const blob = await pluginA.exportAccount();

        expect(typeof blob).toBe("string");

        // Device B: fresh storage; its chain serves ONLY the newer noteB — so any
        // knowledge of noteA can come exclusively from the imported blob.
        const devB = createMockHost({ rpc: chainWithLogs([noteB.log]), blockNumber: 102n });

        await seedIndex(devB.host.storage);
        const pluginB = await createPPv2Plugin(devB.host, params());

        await pluginB.importAccount(blob);

        // Imported state + incremental discovery of the post-export deposit.
        const balances = await pluginB.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(1500n);

        const notes = await pluginB.notes();

        expect(notes.map((n) => n.commitment).sort()).toEqual(
            [noteA.commitment, noteB.commitment].sort(),
        );
    });
});
