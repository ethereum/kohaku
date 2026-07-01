/**
 * URL and address blocklist.
 * 
 * Blocklists contain sets of known bad addresses, URLs, and URL patterns. Blocked
 * items should be treated as potentially malicious and may be flagged to users or 
 * blocked entirely.
 */
export interface Blocklist {
    /**
     * Checks if a given URL is blocked by the blocklist.
     * 
     * @param origin - Full URL to be checked
     * @returns Indication of the URL's block status
     */
    isOriginBlocked(origin: string): Promise<BlocklistItem>;

    /**
     * Checks if a given address is blocked by the blocklist.
     * 
     * @param address - Full address to be checked, in the format `0x...`
     * @returns Indication of the address's block status
     */
    isAddressBlocked(address: `0x${string}`): Promise<BlocklistItem>;
}

export interface BlocklistItem {
    /**
     * Whether the item is blocked or not.
     */
    blocked: boolean;
    /**
     * The type of blocklist the item was found on, if any. See `BlocklistTypes` 
     * for more details.
     */
    list?: BlocklistTypes;
    /**
     * Plaintext name of the blocklist where the item was found, if any. IE 
     * `securityalliance` or `scamsniffer`.
     */
    source?: string;
}

/**
 * Types of blocklists
 * 
 * - `allowlist` means the item is explicitly allowed.
 * - `blocklist` means the item is explicitly blocked.
 * - `fuzzy` means the item matched a fuzzy entry, and is similar to known bad items.
 */
export enum BlocklistTypes {
    Allowlist = 'allowlist',
    Blocklist = 'blocklist',
    Fuzzy = 'fuzzy'
}

export const NOT_BLOCKED: BlocklistItem = Object.freeze({ blocked: false });

