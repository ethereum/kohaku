import type { Hash, INoteManager, Note, PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { NoteStatus } from "@0xbow-io/privacy-pools-v2-sdk";
import { numberToHex, pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000AA" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const LABEL = pad("0x0a") as Hash;

let seq = 0;

function note(value: bigint, status: NoteStatus, tokenId: string = TOKEN): Note {
    seq += 1;

    return {
        commitment: pad(numberToHex(seq)),
        noteAddressHash: pad("0x01"),
        value: numberToHex(value, { size: 32 }),
        tokenId: tokenId as Note["tokenId"],
        label: LABEL,
        status,
        createdAtBlock: numberToHex(seq),
        spentAtBlock: null,
        txHash: pad("0xab"),
    } as unknown as Note;
}

/** A plugin wired to fixed notes and a no-op session (reads never touch the network). */
function pluginWithNotes(notes: Note[]) {
    const noteManager = { getNotes: () => notes } as unknown as INoteManager;
    const session = {
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
        isKeystoreRegistered: vi.fn(async () => true),
    } as unknown as PoolSession;
    const params = {
        chainId: 11155111n,
        ownerAddress: OWNER,
        asp: { baseUrl: "https://asp.example" },
        relayers: [],
        artifacts: { gatewayUrls: [], manifest: {} },
    } as unknown as PPv2PluginParameters;

    return { plugin: new PPv2Plugin({ session, noteManager, params }), session };
}

describe("PPv2Plugin reads", () => {
    it("instanceId returns the owner address", async () => {
        const { plugin } = pluginWithNotes([]);

        expect(await plugin.instanceId()).toBe(OWNER);
    });

    it("isRegistered proxies the session", async () => {
        const { plugin } = pluginWithNotes([]);

        expect(await plugin.isRegistered()).toBe(true);
    });

    it("syncs before reading (implicit sync, FR-005)", async () => {
        const { plugin, session } = pluginWithNotes([]);

        await plugin.balance(undefined);
        expect(session.discoverNotes).toHaveBeenCalledOnce();
    });

    it("aggregates spendable/unspendable and excludes spent (US4, INV-4)", async () => {
        const { plugin } = pluginWithNotes([
            note(100n, NoteStatus.ACTIVE),
            note(50n, NoteStatus.ACTIVE),
            note(30n, NoteStatus.PENDING),
            note(7n, NoteStatus.INACTIVE),
            note(999n, NoteStatus.SPENT),
            note(999n, NoteStatus.EXITED),
        ]);

        const balances = await plugin.balance(undefined);
        const spendable = balances.find((b) => b.tag === "spendable");
        const unspendable = balances.find((b) => b.tag === "unspendable");

        expect(spendable?.amount).toBe(150n);
        expect(unspendable?.amount).toBe(37n); // 30 pending + 7 inactive; spent/exited excluded
    });

    it("filters balance by requested asset", async () => {
        const { plugin } = pluginWithNotes([
            note(100n, NoteStatus.ACTIVE, TOKEN),
            note(200n, NoteStatus.ACTIVE, "0x2222222222222222222222222222222222222222"),
        ]);

        const balances = await plugin.balance([{ __type: "erc20", contract: TOKEN }]);

        expect(balances).toHaveLength(2); // spendable + unspendable for the one asset
        expect(balances.every((b) => b.asset.__type === "erc20")).toBe(true);
        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(100n);
    });

    it("notes() excludes spent by default, includes with includeSpent", async () => {
        const notes = [note(100n, NoteStatus.ACTIVE), note(999n, NoteStatus.SPENT)];
        const { plugin } = pluginWithNotes(notes);

        expect(await plugin.notes()).toHaveLength(1);
        const all = await plugin.notes(undefined, true);

        expect(all).toHaveLength(2);
        expect(all.map((n) => n.status).sort()).toEqual(["active", "spent"]);
    });

    it("maps note status to labelState", async () => {
        const { plugin } = pluginWithNotes([
            note(1n, NoteStatus.ACTIVE),
            note(1n, NoteStatus.PENDING),
            note(1n, NoteStatus.REJECTED),
        ]);
        const detail = await plugin.notes();
        const byStatus = Object.fromEntries(detail.map((n) => [n.status, n.labelState]));

        expect(byStatus.active).toBe("approved");
        expect(byStatus.pending).toBe("pending");
        expect(byStatus.rejected).toBe("revoked");
    });
});
