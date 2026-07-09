/**
 * T058 (US7 AC-1, INV-2): with empty storage and a keystore with on-chain
 * history, a full sync rediscovers everything from events alone — a
 * self-deposit AND a received (viewing-key-discoverable) transfer note.
 * Storage is a cache; the keystore is the only durable secret.
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
    const asp = createMockAsp(); // default: labels approved

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

describe("recovery from events alone (T058/US7 AC-1)", () => {
    it("rediscovers a self-deposit and a received note from empty storage; twice", async () => {
        // Chain history: a self-deposit and a received transfer note — both
        // encrypted to this account's viewing key (the on-chain-discoverable
        // mechanism is identical; cold-start payloads travel out-of-band instead).
        const bare = createMockHost();
        const deposit = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 700n,
            blockNumber: 1n,
        });
        const received = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 300n,
            blockNumber: 2n,
        });

        received.log.logIndex = "0x1";

        async function freshDevice() {
            const rig = createMockHost({
                rpc: chainWithLogs([deposit.log, received.log]),
                blockNumber: 100n,
            });

            await persistRevocableKeyIndex(
                new KohakuStorageService(rig.host.storage),
                CHAIN_ID,
                OWNER,
                "0x0",
            );

            return rig;
        }

        // Device A: full rescan from block 0 finds both notes.
        const a = await freshDevice();
        const pluginA = await createPPv2Plugin(a.host, params());
        const balancesA = await pluginA.balance(undefined);

        expect(balancesA.find((b) => b.tag === "spendable")?.amount).toBe(1000n);
        const notesA = await pluginA.notes();

        expect(notesA.map((n) => n.commitment).sort()).toEqual(
            [deposit.commitment, received.commitment].sort(),
        );

        // Incremental after recovery: a second read re-adds nothing (cursor
        // persisted; conflict-aware dedupe).
        const again = await pluginA.balance(undefined);

        expect(again.find((b) => b.tag === "spendable")?.amount).toBe(1000n);

        // Device B: an entirely separate empty storage reconstructs the SAME
        // state from the keystore + chain alone (INV-2).
        const b = await freshDevice();
        const pluginB = await createPPv2Plugin(b.host, params());
        const balancesB = await pluginB.balance(undefined);

        expect(balancesB.find((c) => c.tag === "spendable")?.amount).toBe(1000n);
    });
});
