/**
 * T036 (US2 AC-3, INV-5): over REAL discovered notes (two deposits, each with its
 * own label), a transfer bigger than any single label's spendable total fails as
 * `LabelFragmentationError` carrying the per-label breakdown — before any relayer
 * or proving work, and with no note state touched.
 */
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { LabelFragmentationError } from "../../../src/v2/interfaces/errors";
import type {
    PPv2AccountId,
    PPv2PluginParameters,
} from "../../../src/v2/interfaces/plugin.interface";
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
const RECIPIENT = "0x00000000000000000000000000000000000000bb" as PPv2AccountId;
const CHAIN_ID = 11155111n;

function params(): PPv2PluginParameters & {
    proofService: ReturnType<typeof createMockProofService>;
    relayerInteractor: ReturnType<typeof createMockRelayer>;
} {
    const asp = createMockAsp();
    const proofService = createMockProofService();
    const relayerInteractor = createMockRelayer();

    return {
        proofService,
        relayerInteractor,
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
            relayerInteractor,
            proofService,
            entrypointInteractor: createMockEntrypoint(),
        },
    };
}

describe("transfer label fragmentation (T036/US2 AC-3)", () => {
    it("rejects a cross-label amount with the per-label breakdown; notes untouched", async () => {
        // Two deposits → two distinct labels, 400 wei spendable under each.
        const bare = createMockHost();
        const noteA = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 400n,
            blockNumber: 1n,
        });
        const noteB = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 400n,
            blockNumber: 2n,
        });

        noteB.log.logIndex = "0x1";

        const rig = createMockHost({
            rpc: chainWithLogs([noteA.log, noteB.log]),
            blockNumber: 100n,
        });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
            "0x0",
        );

        const p = params();
        const plugin = await createPPv2Plugin(rig.host, p);

        // Fragmentation must be detected BEFORE any proving or relayer traffic:
        // spy on the collaborators the transfer path would hit next.
        const prove = vi.spyOn(p.proofService, "proveTransact");
        const quote = vi.spyOn(p.relayerInteractor, "getTransferQuote");
        const relay = vi.spyOn(p.relayerInteractor, "relayTransfer");

        // 800 total is spendable, but no SINGLE label covers 700 (INV-5).
        const failure = await plugin
            .prepareTransfer({ asset: { __type: "native" }, amount: 700n }, RECIPIENT)
            .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(LabelFragmentationError);

        const fragmentation = failure as LabelFragmentationError;

        expect(fragmentation.required).toBe(700n);
        expect(fragmentation.perLabel).toHaveLength(2);
        expect(fragmentation.perLabel.map((l) => l.spendable)).toEqual([400n, 400n]);
        expect(fragmentation.perLabel.map((l) => l.label).sort()).toEqual(
            [noteA.label, noteB.label].sort(),
        );

        // Selection failed before proving/relaying: no collaborator was invoked
        // and both notes are still active.
        expect(prove).not.toHaveBeenCalled();
        expect(quote).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();

        const balances = await plugin.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(800n);
    });
});
