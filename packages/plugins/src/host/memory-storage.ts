import { Storage } from "./index";

/**
 * Simple in-memory implementation of the host Storage interface.
 */
export class MemoryStorage implements Storage {
    readonly _brand = 'Storage' as const;
    private storage: Record<string, string> = {};

    constructor() { }

    async set(key: string, value: string): Promise<void> {
        this.storage[key] = value;
    }

    async get(key: string): Promise<string | null> {
        return this.storage[key] ?? null;
    }
}