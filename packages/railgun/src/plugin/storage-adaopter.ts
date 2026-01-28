import { Storage, SecretStorage } from "@kohaku-eth/plugins";

export interface StorageLayer {
    read(): Promise<object | undefined>;
    write(data: object): Promise<void>;
}

export class HostStorageAdapter implements StorageLayer {
    constructor(
        private storage: Storage | SecretStorage,
        private key: string
    ) { }

    async read(): Promise<object | undefined> {
        const value = this.storage.get(this.key);
        if (value === null) {
            return undefined;
        }

        try {
            return JSON.parse(value);
        } catch (e) {
            console.error(`Failed to parse storage for key ${this.key}:`, e);
            return undefined;
        }
    }

    async write(data: object): Promise<void> {
        const serialized = JSON.stringify(data);
        this.storage.set(this.key, serialized);
    }
}