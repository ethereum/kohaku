import { describe, expect, it } from "vitest";
import { isFeeCommitmentLive } from "../../../src/v2/internal/quotes";

describe("isFeeCommitmentLive (FR-052 unit normalization)", () => {
    it("handles unix-seconds expirations (SDK schema convention)", () => {
        expect(isFeeCommitmentLive(Math.floor(Date.now() / 1000) + 60)).toBe(true);
        expect(isFeeCommitmentLive(Math.floor(Date.now() / 1000) - 60)).toBe(false);
    });

    it("handles unix-milliseconds expirations (staging relayer convention)", () => {
        // A ms value naively multiplied by 1000 would sit ~250,000 years in the
        // future — the guard would never fire against the live relayer.
        expect(isFeeCommitmentLive(Date.now() + 60_000)).toBe(true);
        expect(isFeeCommitmentLive(Date.now() - 60_000)).toBe(false);
    });
});
