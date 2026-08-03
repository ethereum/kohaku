/**
 * Whether a relayer fee commitment is still live. Relayer implementations
 * disagree on the expiration unit — the SDK schema reads as unix seconds, but
 * the 0xbow staging relayer returns unix MILLISECONDS — so the value is
 * normalized by magnitude: above 1e12 it can only be milliseconds (1e12
 * seconds is the year 33,658; 1e12 ms is 2001). Without this, a ms expiry
 * times 1000 lands ~250,000 years out and the staleness guard never fires
 * (FR-052).
 */
export function isFeeCommitmentLive(expiration: number): boolean {
    const expirationMs = expiration > 1e12 ? expiration : expiration * 1000;

    return expirationMs > Date.now();
}
