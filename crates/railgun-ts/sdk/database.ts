import type { Storage } from "@kohaku-eth/plugins";
import type { Database } from "../pkg";

/**
 * Adapter that wraps a kohaku database and exposes the railgun Database interface.
 */
export class DatabaseAdapter implements Database {
    constructor(private prefix: string, private storage: Storage) { }

    async get(key: string): Promise<string | null> {
        const value = await this.storage.get(this.key(key));
        return value || value === "" ? value : null;
    }

    async set(key: string, value: string): Promise<void> {
        await this.storage.set(this.key(key), value);
    }

    async delete(key: string): Promise<void> {
        await this.storage.set(this.key(key), "");
    }

    private key(key: string): string {
        return `${this.prefix}:${key}`;
    }
}
