// https://github.com/MetaMask/core/blob/main/packages/phishing-controller/src/PhishingController.ts

import { Blocklist, BlocklistItem, BlocklistTypes, NOT_BLOCKED } from "./blocklist";
import { getHostnameFromUrl, getPathFromUrl } from "./utils";

const PHISHING_CONFIG_BASE_URL =
    "https://phishing-detection.api.cx.metamask.io";
const STALELIST_ENDPOINT = "/v1/stalelist";

/** Full stalelist returned by /v1/stalelist. */
interface StalelistResponse {
    allowlist: string[];
    blocklist: string[];
    blocklistPaths: string[];
    fuzzylist: string[];
    tolerance: number;
    version: number;
    lastUpdated: number;
}

/**
 * Blocklist that checks against metamask's domain statelist.
 * 
 * https://github.com/MetaMask/core/tree/main/packages/phishing-controller
 */
export class MetamaskBlocklist implements Blocklist {
    private allowlist: Set<string> = new Set();
    private blocklist: Set<string> = new Set()
    private blocklistPaths: Set<string> = new Set();

    private lastRefresh: number = 0;

    constructor(private refreshInterval: number = 10 * 60 * 1000) { }

    async isOriginBlocked(origin: string): Promise<BlocklistItem> {
        const now = Date.now();
        if (now - this.lastRefresh > this.refreshInterval) {
            await this.refresh();
        }

        const hostname = getHostnameFromUrl(origin);
        if (!hostname) {
            return NOT_BLOCKED;
        }


        if (this.allowlist.has(hostname)) {
            return NOT_BLOCKED;
        }

        if (this.blocklist.has(hostname)) {
            return {
                blocked: true,
                list: BlocklistTypes.Blocklist,
                source: "metamask",
            }
        }

        const path = getPathFromUrl(origin);
        if (!path) {
            return NOT_BLOCKED;
        }
        const hostnameWithPath = hostname + path;

        for (const entry of this.blocklistPaths) {
            if (hostnameWithPath.startsWith(entry)) {
                return { blocked: true, list: BlocklistTypes.Blocklist, source: "metamask" };
            }
        }

        return NOT_BLOCKED;
    }

    async isAddressBlocked(address: `0x${string}`): Promise<BlocklistItem> {
        return NOT_BLOCKED;
    }

    private async refresh() {
        await Promise.all([
            this.refreshStalelist(),
        ]);
        this.lastRefresh = Date.now();
    }

    private async refreshStalelist() {
        try {
            const res = await fetch(
                `${PHISHING_CONFIG_BASE_URL}${STALELIST_ENDPOINT}`,
            );
            if (!res.ok) {
                console.error(`stalelist fetch failed: ${res.status} ${res.statusText}`);
                return;
            }

            const data: StalelistResponse = await res.json();
            this.allowlist.clear();
            this.blocklist.clear();
            this.blocklistPaths.clear();

            data.allowlist.forEach((item) => this.allowlist.add(item));
            data.blocklist.forEach((item) => this.blocklist.add(item));
            data.blocklistPaths.forEach((item) => this.blocklistPaths.add(item));
        } catch (error) {
            console.error("Error refreshing stalelist:", error);
        }
    }
}
