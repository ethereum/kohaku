import { Blocklist, BlocklistItem, BlocklistTypes } from "./blocklist";

/**
 * Combines multiple blocklists into a single blocklist. The combo blocklist will:
 * 
 * - If the item is found on any allowlist, it is allowed.
 * - Otherwise, if the item is found on any blocklist, it is blocked.
 * - Otherwise, if the item is found on any fuzzy list, it is blocked.
 * - Otherwise, it is allowed.
 */
export class ComboBlocklist implements Blocklist {
    constructor(private blocklists: Blocklist[]) { }

    async isOriginBlocked(origin: string): Promise<BlocklistItem> {
        let results = Promise.all(this.blocklists.map(blocklist => blocklist.isOriginBlocked(origin)));
        return this.selectResult(await results);
    }

    async isAddressBlocked(address: `0x${string}`): Promise<BlocklistItem> {
        let results = Promise.all(this.blocklists.map(blocklist => blocklist.isAddressBlocked(address)));
        return this.selectResult(await results);
    }

    private selectResult(results: BlocklistItem[]): BlocklistItem {
        const allowlistResult = results.find(result => result.list === BlocklistTypes.Allowlist);
        if (allowlistResult) {
            return allowlistResult;
        }

        const blocklistResult = results.find(result => result.list === BlocklistTypes.Blocklist);
        if (blocklistResult) {
            return blocklistResult;
        }

        const fuzzyResult = results.find(result => result.list === BlocklistTypes.Fuzzy);
        if (fuzzyResult) {
            return fuzzyResult;
        }

        return {
            blocked: false,
        };
    }
}