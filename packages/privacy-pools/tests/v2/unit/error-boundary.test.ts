/**
 * T069: no raw SDK exception crosses the plugin boundary (FR-060) — every public
 * entry point that touches the session maps failures to typed `PluginError`s.
 * The audit's finding (read paths were unwrapped) is locked in here.
 */
import { PluginError } from "@kohaku-eth/plugins";
import type { INoteManager, PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { describe, expect, it, vi } from "vitest";
import { SyncFailedError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;

/** Async stub that throws an Error carrying an SDK error-class `name`. */
function rawError(name: string): () => Promise<never> {
    return async () => {
        const e = new Error(`${name} boom`);

        e.name = name;
        throw e;
    };
}

/** Plugin over a benign stub session with the given method overrides. */
function pluginWith(session: Partial<PoolSession>) {
    const noteManager = { getNotes: () => [] } as unknown as INoteManager;
    const params = { chainId: 11155111n, ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return new PPv2Plugin({
        session: {
            discoverNotes: vi.fn(async () => []),
            purgePhantomNotes: vi.fn(async () => []),
            isKeystoreRegistered: vi.fn(async () => true),
            ...session,
        } as unknown as PoolSession,
        noteManager,
        params,
    });
}

describe("error boundary (T069/FR-060)", () => {
    it("balance/notes wrap discovery failures as typed SyncFailed", async () => {
        const plugin = pluginWith({
            discoverNotes: rawError("NoteDiscoveryScanFailed"),
        } as unknown as Partial<PoolSession>);

        await expect(plugin.balance(undefined)).rejects.toBeInstanceOf(SyncFailedError);
        await expect(plugin.notes()).rejects.toBeInstanceOf(SyncFailedError);
    });

    it("sync wraps purge failures", async () => {
        const plugin = pluginWith({
            purgePhantomNotes: rawError("RPCInteractorBaseError"),
        } as unknown as Partial<PoolSession>);

        await expect(plugin.sync()).rejects.toBeInstanceOf(SyncFailedError);
    });

    it("isRegistered wraps keystore-read failures", async () => {
        const plugin = pluginWith({
            isKeystoreRegistered: rawError("RegistrationCheckFailed"),
        } as unknown as Partial<PoolSession>);

        const rejection = plugin.isRegistered();

        await expect(rejection).rejects.toBeInstanceOf(PluginError);
    });

    it("every session-touching public method rejects with a PluginError, never raw", async () => {
        const raw = rawError("SomeNovelSdkError");
        const plugin = pluginWith({
            discoverNotes: raw,
            purgePhantomNotes: raw,
            isKeystoreRegistered: raw,
            prepareDeposit: raw,
            prepareColdStartTransfer: raw,
            prepareWithdraw: raw,
            prepareRegisterKeystore: raw,
            prepareRageQuit: raw,
            exportAccount: raw,
            importAccount: raw,
        } as unknown as Partial<PoolSession>);

        // Thunks, not live promises: eagerly-created rejections would trip the
        // unhandled-rejection detector before the loop attaches their handlers.
        const attempts: Array<() => Promise<unknown>> = [
            () => plugin.balance(undefined),
            () => plugin.notes(),
            () => plugin.sync(),
            () => plugin.isRegistered(),
            () => plugin.prepareShield({ asset: { __type: "native" }, amount: 1n }),
            () => plugin.prepareTransfer({ asset: { __type: "native" }, amount: 1n }, OWNER),
            () => plugin.prepareUnshield({ asset: { __type: "native" }, amount: 1n }, OWNER),
            () => plugin.prepareRegisterKeystore(),
            () => plugin.prepareRageQuit("0x01"),
            () => plugin.exportAccount(),
            () => plugin.importAccount("{}"),
        ];

        for (const attempt of attempts) {
            await expect(attempt()).rejects.toBeInstanceOf(PluginError);
        }
    });
});
