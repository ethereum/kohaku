/**
 * T059 (US7 AC-2, FR-033, INV-3): a real export→import round-trip between two
 * devices. Device B's chain does NOT serve device A's note — the imported blob is
 * provably the source of that state — and a newer on-chain note appears only
 * AFTER the import, so its discovery proves incremental sync resumed from the
 * imported cursor (asserted against the actual eth_getLogs fromBlock).
 */
import { type Address, type Hex, toEventSelector } from "viem";
import { describe, expect, it, type Mock } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { chainWithLogs, mintOwnedNoteLog, type RawLog } from "../utils/mock-chain";
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

        // Device B: fresh storage, EMPTY chain at head 0 — construction-time
        // recovery discovery can cache nothing, so noteA's state can come only
        // from the imported blob, and B's own cursor is 0 (not A's 100).
        const logsB: RawLog[] = [];
        const devB = createMockHost({ rpc: chainWithLogs(logsB), blockNumber: 0n });

        await seedIndex(devB.host.storage);
        const pluginB = await createPPv2Plugin(devB.host, params());

        await pluginB.importAccount(blob);

        // Only AFTER the import does B's chain serve the newer note.
        logsB.push(noteB.log);
        devB.setBlockNumber(102n);

        const requestMock = devB.provider.request as unknown as Mock;

        requestMock.mockClear();

        // Imported state + incremental discovery of the post-import deposit.
        const balances = await pluginB.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(1500n);

        const notes = await pluginB.notes();

        expect(notes.map((n) => n.commitment).sort()).toEqual(
            [noteA.commitment, noteB.commitment].sort(),
        );

        // Note discovery genuinely RESUMED from the imported cursor (A exported
        // at head 100): had import not restored it, B (own cursor 0) would rescan
        // note logs from genesis. (Other event categories — leaves, registration —
        // keep their own cursors and may scan from 0.)
        const noteTopic = toEventSelector("event Note(bytes32 indexed hint, bytes data)");
        const noteScans = requestMock.mock.calls
            .map(
                ([req]: [{ method: string; params?: [{ fromBlock?: Hex; topics?: unknown[] }] }]) =>
                    req,
            )
            .filter(
                (req) =>
                    req.method === "eth_getLogs" &&
                    JSON.stringify(req.params?.[0]?.topics ?? []).includes(noteTopic),
            );

        expect(noteScans.length).toBeGreaterThan(0);

        for (const scan of noteScans) {
            expect(BigInt(scan.params?.[0]?.fromBlock ?? 0n)).toBeGreaterThanOrEqual(100n);
        }
    });
});
