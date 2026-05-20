import type { Storage } from "@kohaku-eth/plugins";
import type { Database } from "../pkg";

/**
 * Adapter that wraps a kohaku database and exposes the railgun Database interface.
 */
export class DatabaseAdapter implements Database {
    constructor(private prefix: string, private storage: Storage) { }

    async get(key: string): Promise<string | null> {
        const value = this.storage.get(this.key(key));

        // TODO: Remove me once delete is implemented
        return value || value === "" ? value : null;
    }

    async set(key: string, value: string): Promise<void> {
        this.storage.set(this.key(key), value);
    }

    async delete(key: string): Promise<void> {
        this.storage.set(this.key(key), ""); // TODO: Add a delete method to Storage
    }

    private key(key: string): string {
        return `${this.prefix}:${key}`;
    }
}
