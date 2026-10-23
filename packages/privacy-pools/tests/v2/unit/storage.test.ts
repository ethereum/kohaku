import type { Storage as HostStorage } from "@kohaku-eth/plugins";
import { describe, expect, it } from "vitest";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { StorageCorruptionError } from "../../../src/v2/interfaces/errors";

/** Minimal in-memory host storage (get/set only), mirroring the Host contract. */
function memoryStorage(): HostStorage & { raw: Map<string, string> } {
    const raw = new Map<string, string>();

    return {
        _brand: "Storage",
        raw,
        async get(key) {
            return raw.has(key) ? (raw.get(key) as string) : null;
        },
        async set(key, value) {
            raw.set(key, value);
        },
    };
}

describe("KohakuStorageService", () => {
    it("round-trips JSON values under the ppv2: prefix", async () => {
        const mem = memoryStorage();
        const svc = new KohakuStorageService(mem);

        await svc.set("notes", { a: 1, b: [2, 3] });
        expect(await svc.get("notes")).toEqual({ a: 1, b: [2, 3] });
        expect([...mem.raw.keys()]).toEqual(["ppv2:notes"]);
    });

    it("applies a storeKey discriminator to the prefix", async () => {
        const mem = memoryStorage();
        const svc = new KohakuStorageService(mem, "acct1");

        await svc.set("k", 42);
        expect([...mem.raw.keys()]).toEqual(["ppv2:acct1:k"]);
    });

    it("delete tombstones the key so get returns null", async () => {
        const mem = memoryStorage();
        const svc = new KohakuStorageService(mem);

        await svc.set("k", "v");
        await svc.delete("k");
        expect(await svc.get("k")).toBeNull();
        // tombstone is physically present, not removed
        expect(mem.raw.has("ppv2:k")).toBe(true);
    });

    it("returns null for a missing key", async () => {
        const svc = new KohakuStorageService(memoryStorage());

        expect(await svc.get("missing")).toBeNull();
    });

    it("fails closed with StorageCorruptionError on invalid JSON", async () => {
        const mem = memoryStorage();

        mem.raw.set("ppv2:bad", "{ not json");
        const svc = new KohakuStorageService(mem);

        await expect(svc.get("bad")).rejects.toBeInstanceOf(StorageCorruptionError);
    });

    it("rejects clear()", async () => {
        const svc = new KohakuStorageService(memoryStorage());

        await expect(svc.clear()).rejects.toThrowError();
    });
});
