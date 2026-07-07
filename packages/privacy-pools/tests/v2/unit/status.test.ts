import { NoteStatus } from "@privacy-pools-v2/sdk";
import { describe, expect, it } from "vitest";
import {
    isExcluded,
    isSpendable,
    statusLabel,
    statusToReport,
} from "../../../src/v2/mapping/status";

describe("status mapping", () => {
    it("reports ACTIVE as spendable", () => {
        expect(statusToReport(NoteStatus.ACTIVE)).toBe("spendable");
        expect(isSpendable(NoteStatus.ACTIVE)).toBe(true);
    });

    it("reports INACTIVE / PENDING / REJECTED as unspendable", () => {
        for (const s of [NoteStatus.INACTIVE, NoteStatus.PENDING, NoteStatus.REJECTED]) {
            expect(statusToReport(s)).toBe("unspendable");
            expect(isSpendable(s)).toBe(false);
            expect(isExcluded(s)).toBe(false);
        }
    });

    it("excludes SPENT / EXITED", () => {
        for (const s of [NoteStatus.SPENT, NoteStatus.EXITED]) {
            expect(statusToReport(s)).toBe("excluded");
            expect(isExcluded(s)).toBe(true);
            expect(isSpendable(s)).toBe(false);
        }
    });

    it("lowercases the status label", () => {
        expect(statusLabel(NoteStatus.ACTIVE)).toBe("active");
        expect(statusLabel(NoteStatus.EXITED)).toBe("exited");
    });
});
