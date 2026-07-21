/**
 * LIVE MODE — JSON-file-backed Host `Storage`, so sync cursors, discovered
 * notes, and the revocable-key index persist across runs (the extension backs
 * this with encrypted browser storage). Values may reference on-chain private
 * state; the file is gitignored.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Storage as PluginStorage } from "@kohaku-eth/plugins";

export function createFileStorage(filePath: string): PluginStorage {
    const load = (): Record<string, string> => {
        if (!existsSync(filePath)) return {};

        return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
    };

    return {
        _brand: "Storage",
        async set(key, value) {
            const data = load();

            data[key] = value;
            writeFileSync(filePath, JSON.stringify(data, null, 2));
        },
        async get(key) {
            return load()[key] ?? null;
        },
    };
}
