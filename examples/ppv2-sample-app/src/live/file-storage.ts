/**
 * LIVE MODE — JSON-file-backed Host `Storage`, so sync cursors, discovered
 * notes, and the revocable-key index persist across runs (the extension backs
 * this with encrypted browser storage). Values may reference on-chain private
 * state; the file is gitignored.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Storage as PluginStorage } from "@kohaku-eth/plugins";

export function createFileStorage(filePath: string): PluginStorage {
    const load = (): Record<string, string> => {
        if (!existsSync(filePath)) return {};

        return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
    };

    return {
        _brand: "Storage",
        // The read-modify-write is fully synchronous (no await points), so
        // concurrent set() calls cannot interleave on the event loop. The
        // tmp+rename makes the write atomic against a crash mid-write — a torn
        // file would otherwise fail every later load().
        async set(key, value) {
            const data = load();

            data[key] = value;

            const tmpPath = `${filePath}.tmp`;

            writeFileSync(tmpPath, JSON.stringify(data, null, 2));
            renameSync(tmpPath, filePath);
        },
        async get(key) {
            return load()[key] ?? null;
        },
    };
}
