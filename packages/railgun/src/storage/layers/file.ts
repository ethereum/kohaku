import { readFile, writeFile } from "fs/promises";
import { StorageLayer } from "../base";
import { existsSync } from "fs";
import { join } from "path";

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node;

export type FileStorageParams = {
    skipWrite?: boolean;
};

export const createFileStorageLayer = (path: string, params?: FileStorageParams): StorageLayer => {
    if (isBrowser) {
        throw new Error(
            'File storage is not available in browser environments. ' +
            'Use createEmptyStorageLayer() or implement a custom StorageLayer for browser storage (e.g., IndexedDB, localStorage).'
        );
    }

    const fullPath = join(process.cwd(), path);
    const skipWrite = params?.skipWrite ?? false;

    console.log('fullPath', fullPath);

    return {
        async read() {
            if (!existsSync(fullPath)) return;

            return JSON.parse(await readFile(fullPath, 'utf8'));
        },
        async write(data) {
            if (skipWrite) return;
            
            console.log('writing to file', fullPath);

            await writeFile(fullPath, JSON.stringify(data));
        },
    }
}
