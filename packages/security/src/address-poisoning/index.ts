export interface PoisonResult {
    /**
     * Target address that is being poisoned
     */
    target: `0x${string}`;
    /**
     * Similarity score (0-1)
     */
    similarity: number;
}

/**
 * Detect if a suspect address is potentially poisoned by comparing it to a list 
 * of trusted addresses.
 * 
 * 
 * 
 * @param suspect Address to check for poisoning 
 * @param trusted List of known trusted addresses to compare against
 * @param threshold Similarity threshold (0-1) above which an address is considered poisoned. Default is 0.8.
 * @param prefix Number of characters from the start and end of the address to compare for similarity. Default is 4.
 * @returns A PoisonResult if the suspect address is considered poisoned, or null if it is not.
 */
export function isAddressPoisoned(suspect: `0x${string}`, trusted: `0x${string}`[], threshold: number = 0.8, prefix: number = 4): PoisonResult | null {
    const s = suspect.toLowerCase().slice(2);
    for (const t of trusted) {
        const tr = t.toLowerCase().slice(2);
        if (s === tr) continue; // same address, skip

        const prefixSim = 1 - levenshtein(s.slice(0, prefix), tr.slice(0, prefix)) / prefix;
        const suffixSim = 1 - levenshtein(s.slice(-prefix), tr.slice(-prefix)) / prefix;
        const similarity = (prefixSim + suffixSim) / 2;

        if (similarity >= threshold) {
            return { target: t, similarity };
        }
    }
    return null;
}

function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i]![j]! = a[i - 1] === b[j - 1]
                ? dp[i - 1]![j - 1]!
                : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
    }
    return dp[m]![n]!;
}