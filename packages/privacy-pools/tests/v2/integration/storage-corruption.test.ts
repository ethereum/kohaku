/**
 * T065 (F6): corrupt persisted note state fails CLOSED — a typed
 * `StorageCorruptionError` at init, never a silent reset of state (Principle I).
 */
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { StorageCorruptionError } from "../../../src/v2/interfaces/errors";
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

function params(): PPv2PluginParameters {
    return {
        chainId: 11155111n,
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
            aspClient: createMockAsp(),
            aspDataProvider: createMockAsp(),
            relayerInteractor: createMockRelayer(),
            proofService: createMockProofService(),
            entrypointInteractor: createMockEntrypoint(),
        },
    };
}

describe("storage corruption fails closed (T065/F6)", () => {
    it("throws typed StorageCorruption at init and never silently resets state", async () => {
        // Seed real persisted note state: discover a mined note, which flushes
        // the note-manager state through the storage adapter.
        const bare = createMockHost();
        const minted = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
        });
        const rig = createMockHost({ rpc: chainWithLogs([minted.log]), blockNumber: 100n });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            11155111n,
            OWNER,
            "0x0",
        );
        const plugin = await createPPv2Plugin(rig.host, params());

        await plugin.balance(undefined); // discover + persist

        const noteKeys = [...rig.storage.map.keys()].filter(
            (k) => k.startsWith("ppv2:") && !k.includes("keystore"),
        );

        expect(noteKeys.length).toBeGreaterThan(0);

        // Corrupt every persisted note-state value (partial-write simulation).
        for (const key of noteKeys) rig.storage.map.set(key, "{ definitely not json");
        const snapshot = new Map(rig.storage.map);

        // Fail closed: a new instance over the corrupt store throws the typed
        // error instead of constructing with silently-reset state.
        await expect(createPPv2Plugin(rig.host, params())).rejects.toBeInstanceOf(
            StorageCorruptionError,
        );

        // Nothing was wiped or overwritten — the corrupt evidence is intact.
        expect(rig.storage.map).toEqual(snapshot);
    });
});
