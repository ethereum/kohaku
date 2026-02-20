import { StorageLayer } from "../base";

// Empty storage layer mostly used for tests
export const createEmptyStorageLayer = (): StorageLayer => {
    let storage: string | undefined;

    return {
        get() {
            if (!storage) return;

            return JSON.parse(storage);
        },
        async set(data) {
            storage = JSON.stringify(data);
        },
    }
}
