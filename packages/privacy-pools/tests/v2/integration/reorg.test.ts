/**
 * T063 (F3, FR-034): a reorg drops a discovered note's block from canonical
 * history. Plain reads never destroy state; the explicit `sync()` runs the SDK's
 * phantom-note purge, which deletes the orphaned note only after the chain itself
 * confirms absence (`getCommitmentTimestamp == 0` per-candidate double-check) —
 * so the balance is never overstated after recovery, and a note still on-chain
 * survives the same purge untouched.
 */
import type { Address } from "viem";
import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { mintOwnedNoteLog, type RawLog } from "../utils/mock-chain";
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

describe("reorg recovery (T063/F3, FR-034)", () => {
    it("purges an orphaned note on explicit sync; reads alone never delete", async () => {
        const bare = createMockHost();
        const minted = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
            blockNumber: 90n,
        });

        // Mutable chain: before the reorg it serves the note's log and a nonzero
        // commitment timestamp; after, the block is orphaned — no log, timestamp 0.
        let reorged = false;
        const rig = createMockHost({
            rpc: {
                eth_getLogs: (): RawLog[] => (reorged ? [] : [minted.log]),
                eth_call: () => (reorged ? pad("0x0") : pad("0x1")),
            },
            blockNumber: 100n,
        });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
            "0x0",
        );

        const plugin = await createPPv2Plugin(rig.host, params());

        // Discovered and spendable on the pre-reorg chain.
        const before = await plugin.balance(undefined);

        expect(before.find((b) => b.tag === "spendable")?.amount).toBe(1000n);

        // A full sync while the note IS canonical must not purge it: the purge's
        // per-candidate on-chain double-check (nonzero timestamp) protects it.
        await plugin.sync();

        expect(
            (await plugin.balance(undefined)).find((b) => b.tag === "spendable")?.amount,
        ).toBe(1000n);

        // Reorg: the note's block drops out of canonical history.
        reorged = true;
        rig.setBlockNumber(101n);

        // Plain reads re-scan but never destroy state — the cached note still
        // shows until the wallet asks for a reconciling sync.
        const cached = await plugin.balance(undefined);

        expect(cached.find((b) => b.tag === "spendable")?.amount).toBe(1000n);

        // Explicit sync: purge confirms absence on-chain (timestamp 0) and deletes.
        await plugin.sync();

        const after = await plugin.balance(undefined);

        expect(after.find((b) => b.tag === "spendable")?.amount ?? 0n).toBe(0n);

        // Deleted, not status-flipped: gone even from the include-spent view.
        expect(await plugin.notes(undefined, true)).toHaveLength(0);
    });
});
