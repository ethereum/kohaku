import { readFile, writeFile } from "fs/promises";
import { StorageLayer } from "../base";
import { existsSync } from "fs";
import { join } from "path";

export type FileStorageParams = {
    skipWrite?: boolean;
};

export const createFileStorageLayer = (path: string, params?: FileStorageParams): StorageLayer => {
    const fullPath = join(process.cwd(), path);
    const skipWrite = params?.skipWrite ?? false;

    console.log('fullPath', fullPath);

    return {
        async read() {
            if (!existsSync(fullPath)) return;

            return JSON.parse(await readFile(fullPath, 'utf8'));
        },
        async write(data) {
            console.log('writing to file', fullPath);

            if (skipWrite) return;

            await writeFile(fullPath, JSON.stringify(data));
        },
    }
}
