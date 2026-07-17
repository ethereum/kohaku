import type { Hex } from "@0xbow-io/privacy-pools-v2-sdk";
import type { KohakuStorageService } from "../adapters/storage.adapter";

/**
 * Plugin-owned keystore record: the one piece of key state the SDK does not
 * persist — the revocable-key rotation index (FR-013). Contains NO raw key
 * material (INV-3); keyed by chain + owner so co-resident instances stay
 * disjoint (INV-6).
 */
export type KeystoreRecord = {
    /** Schema version for forward migrations. */
    version: 1;
    /** The account's current revocable-key rotation index (0x-hex u64). */
    revocableKeyIndex: Hex;
};

function recordKey(chainId: bigint, ownerAddress: string): string {
    return `keystore:${chainId}:${ownerAddress.toLowerCase()}`;
}

/** Read the persisted rotation index, or `null` on a fresh device. */
export async function readRevocableKeyIndex(
    storage: KohakuStorageService,
    chainId: bigint,
    ownerAddress: string,
): Promise<Hex | null> {
    const record = await storage.get<KeystoreRecord>(recordKey(chainId, ownerAddress));

    return record?.revocableKeyIndex ?? null;
}

/** Persist the rotation index (after discovery or observed rotation). */
export async function persistRevocableKeyIndex(
    storage: KohakuStorageService,
    chainId: bigint,
    ownerAddress: string,
    revocableKeyIndex: Hex,
): Promise<void> {
    await storage.set<KeystoreRecord>(recordKey(chainId, ownerAddress), {
        version: 1,
        revocableKeyIndex,
    });
}
