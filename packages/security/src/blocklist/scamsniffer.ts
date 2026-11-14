import { Blocklist, BlocklistItem, BlocklistTypes, NOT_BLOCKED } from "./blocklist";
import { getHostnameFromUrl } from "./utils";

const SCAM_SNIFFER_DOMAIN_BLOCKLIST_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/domains.json";
const SCAM_SNIFFER_ADDRESS_BLOCKLIST_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/address.json"

/**
 * Blocklist that checks against the ScamSniffer blocklist for both domains and Ethereum addresses.
 * 
 * ScamSniffer updates their blocklist every 24 hours, with a 7-day delay for new 
 * entries for their freely available list.
 * 
 * https://github.com/scamsniffer/scam-database
 */
export class ScamSnifferBlocklist implements Blocklist {
    private domainBlocklist: Set<string> = new Set();
    private addressBlocklist: Set<string> = new Set();
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

        const blocked = this.domainBlocklist.has(domain);
        return {
            blocked,
            list: blocked ? BlocklistTypes.Blocklist : undefined,
            source: blocked ? "scamsniffer" : undefined,
        };
    }

    async isAddressBlocked(address: `0x${string}`): Promise<BlocklistItem> {
        const now = Date.now();
        if (now - this.lastRefresh > this.refreshInterval) {
            await this.refreshBlocklist();
        }

        const blocked = this.addressBlocklist.has(normalizeAddress(address));
        return {
            blocked,
            list: blocked ? BlocklistTypes.Blocklist : undefined,
            source: blocked ? "scamsniffer" : undefined,
        };
    }

    private async refreshBlocklist() {
        await Promise.all([
            this.refreshDomainBlocklist(),
            this.refreshAddressBlocklist(),
        ]);
        this.lastRefresh = Date.now();
    }

    private async refreshDomainBlocklist() {
        try {
            const response = await fetch(SCAM_SNIFFER_DOMAIN_BLOCKLIST_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch domain blocklist: ${response.statusText}`);
            }
            const domains: string[] = await response.json();
            this.domainBlocklist = new Set(domains);
        } catch (error) {
            console.error("Error refreshing domain blocklist:", error);
        }
    }

    private async refreshAddressBlocklist() {
        try {
            const response = await fetch(SCAM_SNIFFER_ADDRESS_BLOCKLIST_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch address blocklist: ${response.statusText}`);
            }
            const addresses: string[] = await response.json();
            this.addressBlocklist = new Set(addresses.map(normalizeAddress));
        } catch (error) {
            console.error("Error refreshing address blocklist:", error);
        }
    }
}

function normalizeAddress(address: string): string {
    return address.toLocaleLowerCase();
}