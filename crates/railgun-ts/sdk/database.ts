import type { Storage } from "@kohaku-eth/plugins";
import type { Database } from "../pkg";

/**
 * Adapter that wraps a kohaku database and exposes the railgun Database interface.
 * 
 * TODO: Delete me once delete is implemented in storage since we can just use storage directly.
 */
export class DatabaseAdapter implements Database {
    constructor(private storage: Storage) { }

    async get(key: string): Promise<string | null> {
        const value = this.storage.get(key);

        // TODO: Remove me once delete is implemented
        return value || value === "" ? value : null;
    }

    async set(key: string, value: string): Promise<void> {
        this.storage.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.storage.set(key, ""); // TODO: Add a delete method to Storage
    }
}
