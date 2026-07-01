import { Blocklist, BlocklistItem, BlocklistTypes, NOT_BLOCKED } from "./blocklist";
import { getHostnameFromUrl } from "./utils";

const SECURITY_ALLIANCE_BLOCKLIST_URL = "https://raw.githubusercontent.com/security-alliance/blocklists/refs/heads/main/domain.txt";

/**
 * Blocklist that checks against the Security Alliance blocklist for domains.
 * 
 * SEAL updates their blocklist in real-time.
 * 
 * https://github.com/security-alliance/blocklists
 */
export class SecurityAllianceBlocklist implements Blocklist {
    private blocklist: Set<string> = new Set();
    private lastRefresh: number = 0;

    constructor(private refreshInterval: number = 10 * 60 * 1000) { }

    async isOriginBlocked(origin: string): Promise<BlocklistItem> {
        const now = Date.now();
        if (now - this.lastRefresh > this.refreshInterval) {
            await this.refreshBlocklist();
        }

        const domain = getHostnameFromUrl(origin);
        if (!domain) {
            return NOT_BLOCKED;
        }

        const blocked = this.blocklist.has(domain);
        return {
            blocked,
            list: blocked ? BlocklistTypes.Blocklist : undefined,
            source: blocked ? "securityalliance" : undefined,
        };
    }

    async isAddressBlocked(address: `0x${string}`): Promise<BlocklistItem> {
        return NOT_BLOCKED;
    }

    private async refreshBlocklist() {
        try {
            const response = await fetch(SECURITY_ALLIANCE_BLOCKLIST_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch blocklist: ${response.statusText}`);
            }
            const text = await response.text();
            this.blocklist = new Set(text.split("\n").map(line => line.trim()).filter(line => line.length > 0));
            this.lastRefresh = Date.now();
        } catch (error) {
            console.error("Error refreshing blocklist:", error);
        }
    }
}
