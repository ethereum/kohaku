import type { INoteManager, PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { describe, expect, it, vi } from "vitest";
import {
    persistRevocableKeyIndex,
    readRevocableKeyIndex,
} from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { AccountImportMismatchError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";
import { createMemoryStorage } from "../utils/mock-host";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;

/** Plugin over a no-op sync session with the given method overrides. */
function makePlugin(session: Partial<PoolSession>) {
    const full = {
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
        ...session,
    } as unknown as PoolSession;
    const noteManager = { getNotes: () => [] } as unknown as INoteManager;
    const params = { chainId: 11155111n, ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return new PPv2Plugin({ session: full, noteManager, params });
}

describe("PPv2Plugin export/import (US7)", () => {
    it("round-trips the SDK envelope through a string blob (FR-033)", async () => {
        const envelope = { owner: OWNER, chainId: 11155111, notes: [], syncCursor: "0x0" };
        const importAccount = vi.fn(async () => undefined);
        const plugin = makePlugin({
            exportAccount: vi.fn(async () => envelope),
            importAccount,
        } as unknown as Partial<PoolSession>);

        const blob = await plugin.exportAccount();

        expect(typeof blob).toBe("string");
        await plugin.importAccount(blob);
        expect(importAccount).toHaveBeenCalledWith(envelope);
    });

    it("rejects a malformed blob with a typed error", async () => {
        const plugin = makePlugin({});

        await expect(plugin.importAccount("{ not json")).rejects.toBeInstanceOf(
            AccountImportMismatchError,
        );
    });

    it("maps the SDK owner/chain mismatch to AccountImportMismatch (FR-033)", async () => {
        const plugin = makePlugin({
            importAccount: vi.fn(async () => {
                const e = new Error("wrong owner");

                e.name = "AccountExportMismatch";
                throw e;
            }),
        } as unknown as Partial<PoolSession>);

        await expect(plugin.importAccount("{}")).rejects.toBeInstanceOf(
            AccountImportMismatchError,
        );
    });
});

describe("keystore record (T062)", () => {
    it("returns null on a fresh device and round-trips the persisted index", async () => {
        const storage = new KohakuStorageService(createMemoryStorage());

        expect(await readRevocableKeyIndex(storage, 11155111n, OWNER)).toBeNull();

        await persistRevocableKeyIndex(storage, 11155111n, OWNER, "0x3");
        expect(await readRevocableKeyIndex(storage, 11155111n, OWNER)).toBe("0x3");
    });

    it("namespaces by chain and owner (INV-6)", async () => {
        const storage = new KohakuStorageService(createMemoryStorage());

        await persistRevocableKeyIndex(storage, 1n, OWNER, "0x1");
        expect(await readRevocableKeyIndex(storage, 11155111n, OWNER)).toBeNull();
        expect(
            await readRevocableKeyIndex(storage, 1n, "0x00000000000000000000000000000000000000bb"),
        ).toBeNull();
    });
});
