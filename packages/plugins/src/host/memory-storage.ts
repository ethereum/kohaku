import { Storage } from "./index";

/**
 * Simple in-memory implementation of the host Storage interface.
 */
export class MemoryStorage implements Storage {
    readonly _brand = 'Storage' as const;
    private storage: Record<string, string> = {};

    constructor() { }

    set(key: string, value: string): void {
        this.storage[key] = value;
    }

    get(key: string): string | null {
        return this.storage[key] ?? null;
    }
}