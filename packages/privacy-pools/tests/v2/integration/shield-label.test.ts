/**
 * T031 (US1 AC-3/4): a mined deposit is discovered from chain events, reports
 * unspendable while its label awaits ASP approval, and flips to spendable when
 * the ASP approves. T047 (US4 AC-3): a fresh instance with empty storage
 * discovers on-chain history before answering balance().
 *
 * Runs the REAL discovery pipeline: raw `Note` event log → RPC adapter decode →
 * catch-all trial ECDH decrypt with the account's viewing key → Poseidon
 * commitment recompute → label-status reconciliation via the mock ASP.
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

function params(asp: ReturnType<typeof createMockAsp>): PPv2PluginParameters {
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

/** Host over a chain that holds one mined, owned note. */
async function hostWithMinedNote() {
    // Keystore is deterministic from the default test mnemonic, so the fixture can
    // derive the same viewing key the plugin will use — before the host exists.
    const bare = createMockHost();
    const minted = await mintOwnedNoteLog({
        host: bare.host,
        ownerAddress: OWNER,
        tokenId: NATIVE,
        value: 1000n,
    });
    const rig = createMockHost({ rpc: chainWithLogs([minted.log]), blockNumber: 100n });

    // Pre-seed the rotation-index record: the mock chain's nonzero eth_call would
    // otherwise read as "registered" and trigger a gap scan against garbage data.
    await persistRevocableKeyIndex(
        new KohakuStorageService(rig.host.storage),
        CHAIN_ID,
        OWNER,
        "0x0",
    );

    return { host: rig.host, minted, setBlockNumber: rig.setBlockNumber };
}

describe("US1/US4 discovery lifecycle (T031/T047)", () => {
    it("discovers the mined deposit and moves it unspendable → spendable on ASP approval (T031)", async () => {
        const { host, minted, setBlockNumber } = await hostWithMinedNote();
        const asp = createMockAsp();

        asp.setLabelStatus(minted.labelHash, "pending");
        const plugin = await createPPv2Plugin(host, params(asp));

        // Discovered from the chain event; label not yet approved → unspendable.
        const before = await plugin.balance(undefined);

        expect(before.find((b) => b.tag === "unspendable")?.amount).toBe(1000n);
        expect(before.find((b) => b.tag === "spendable")?.amount).toBe(0n);

        // ASP approves the label; a new block lands (discovery only re-scans past
        // the cursor) → next read reconciles the note to spendable.
        asp.setLabelStatus(minted.labelHash, "approved");
        setBlockNumber(101n);
        const after = await plugin.balance(undefined);

        expect(after.find((b) => b.tag === "spendable")?.amount).toBe(1000n);
        expect(after.find((b) => b.tag === "unspendable")?.amount).toBe(0n);
    });

    it("a fresh instance with empty storage discovers history before answering (T047)", async () => {
        const { host, minted } = await hostWithMinedNote();
        const asp = createMockAsp(); // default: approved

        asp.setLabelStatus(minted.labelHash, "approved");
        const plugin = await createPPv2Plugin(host, params(asp));

        const balances = await plugin.balance(undefined);
        const spendable = balances.find((b) => b.tag === "spendable");

        expect(spendable?.amount).toBe(1000n);
        expect(spendable?.asset).toEqual({ __type: "native" });

        const detail = await plugin.notes();

        expect(detail).toHaveLength(1);
        expect(detail[0]?.commitment).toBe(minted.commitment);
        expect(detail[0]?.labelState).toBe("approved");
    });
});
