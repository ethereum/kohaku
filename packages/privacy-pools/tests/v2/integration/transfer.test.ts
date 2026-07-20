/**
 * T035 + T037 (US2 AC-1/2/4): the FULL cold-start transfer arc over the real SDK
 * pipeline — discovery, input selection, the real transact witness (state-tree,
 * keystore-tree, and ASP-tree merkle proofs all built from mock-chain fixtures),
 * relayer quotes, broadcast through the shared session, and post-mine note
 * reconciliation. Only proving, HTTP, and the chain itself are mocks.
 *
 * T035: inputs stay `active` through prepare; the mined relay marks them `spent`
 * and adds the change note, which turns spendable on the next sync.
 * T037 (F1): a relayer rejection at broadcast leaves inputs `active` — no
 * rollback needed because nothing was ever marked.
 */
import type { Address } from "viem";
import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { RelayerUnavailableError } from "../../../src/v2/interfaces/errors";
import type {
    PPv2AccountId,
    PPv2PluginParameters,
} from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Broadcaster } from "../../../src/v2/broadcaster";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import {
    chainWithLogs,
    mintKeystoreLeafLog,
    mintOwnedNoteLog,
    mintStateLeavesLog,
} from "../utils/mock-chain";
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

/** Offline plugin params over the caller's mock relayer, exposing the shared ASP. */
function params(relayer: ReturnType<typeof createMockRelayer>): {
    asp: ReturnType<typeof createMockAsp>;
    pluginParams: PPv2PluginParameters;
} {
    const asp = createMockAsp();

    return {
        asp,
        pluginParams: {
            chainId: CHAIN_ID,
            ownerAddress: OWNER,
            asp: { baseUrl: "https://asp.mock" },
            relayers: [],
            artifacts: {
                gatewayUrls: ["https://ipfs.mock/ipfs"],
                manifest: {
                    transact_1x1: {
                        wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
                        provingKey:
                            "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
                        verificationKey:
                            "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
                    },
                },
            },
            factories: {
                aspClient: asp,
                aspDataProvider: asp,
                relayerInteractor: relayer,
                proofService: createMockProofService(),
                entrypointInteractor: createMockEntrypoint(),
            },
        },
    };
}

/** Chain + plugin holding one discovered 1000-wei note with full witness fixtures. */
async function transferRig(relayer: ReturnType<typeof createMockRelayer>) {
    const bare = createMockHost();
    const minted = await mintOwnedNoteLog({
        host: bare.host,
        ownerAddress: OWNER,
        tokenId: NATIVE,
        value: 1000n,
        blockNumber: 1n,
    });
    // Witness fixtures: the note's timestamped leaf in the pool state tree and
    // the owner's leaf in the keystore tree.
    const stateLeaves = await mintStateLeavesLog([minted.commitment], { blockNumber: 1n });
    const keystoreLeaf = await mintKeystoreLeafLog(bare.host, OWNER, 2n);

    const rig = createMockHost({
        rpc: {
            ...chainWithLogs([minted.log, stateLeaves.log, keystoreLeaf.log]),
            // The relayed tx mines successfully.
            eth_getTransactionReceipt: () => ({
                transactionHash: pad("0xbeef"),
                status: "0x1",
                blockNumber: "0x65",
                logs: [],
            }),
        },
        blockNumber: 100n,
    });

    await persistRevocableKeyIndex(
        new KohakuStorageService(rig.host.storage),
        CHAIN_ID,
        OWNER,
        "0x0",
    );

    const { asp, pluginParams } = params(relayer);
    const plugin = await createPPv2Plugin(rig.host, pluginParams);

    // The note's label is ASP-approved: present in the association set.
    asp.associationLeaves.push(minted.labelHash);

    return { rig, plugin, minted };
}

describe("cold-start transfer end-to-end (T035/US2 AC-1/2)", () => {
    it("prepares over real witnesses, relays, marks inputs spent, and frees the change", async () => {
        const relayer = createMockRelayer({ feeAmount: 5n });
        const { rig, plugin, minted } = await transferRig(relayer);

        expect(
            (await plugin.balance(undefined)).find((b) => b.tag === "spendable")?.amount,
        ).toBe(1000n);

        // Prepare: selection + REAL transact witness + quotes. Inputs stay active.
        const op = await plugin.prepareTransfer(
            { asset: { __type: "native" }, amount: 700n },
            RECIPIENT,
        );

        expect(op.kind).toBe("transfer");

        const stillActive = await plugin.notes();

        expect(stillActive).toHaveLength(1);
        expect(stillActive[0].status).toBe("active");

        // Broadcast through the shared session: re-prove, relay, mine, reconcile.
        const result = await createPPv2Broadcaster(plugin).broadcast(op);

        expect(result.txHash).toBe(pad("0xbeef"));

        // Cold-start payload carries the recipient's 700-wei note out-of-band.
        const recipientNotes = JSON.parse(result.coldStartPayload) as Array<{ value: string }>;

        expect(recipientNotes.length).toBeGreaterThan(0);
        expect(recipientNotes.map((n) => BigInt(n.value))).toContain(700n);

        // Post-mine: the input is spent; the change note exists but is pending.
        const all = await plugin.notes(undefined, true);
        const spent = all.find((n) => n.commitment === minted.commitment);

        expect(spent?.status).toBe("spent");

        // Next sync re-checks the change note's (inherited, approved) label →
        // spendable change = 1000 − 700 − 5 fee.
        rig.setBlockNumber(101n);

        const balances = await plugin.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(295n);
    });
});

describe("relayer rejection at broadcast (T037/F1, US2 AC-4)", () => {
    it("surfaces a typed error and leaves the inputs active — nothing to roll back", async () => {
        const relayer = createMockRelayer({ feeAmount: 5n, relayError: "RelayerRejected" });
        const { plugin } = await transferRig(relayer);

        const op = await plugin.prepareTransfer(
            { asset: { __type: "native" }, amount: 700n },
            RECIPIENT,
        );

        await expect(createPPv2Broadcaster(plugin).broadcast(op)).rejects.toBeInstanceOf(
            RelayerUnavailableError,
        );

        // The failed relay never marked anything: full balance still spendable.
        const notes = await plugin.notes(undefined, true);

        expect(notes).toHaveLength(1);
        expect(notes[0].status).toBe("active");

        const balances = await plugin.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(1000n);
    });
});
