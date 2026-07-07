import { type Hash, type Note, NoteStatus } from "@privacy-pools-v2/sdk";
import { numberToHex, pad } from "viem";
import { describe, expect, it } from "vitest";
import { LabelFragmentationError } from "../../../src/v2/interfaces/errors";
import { selectInputNotes } from "../../../src/v2/selection/note-selection";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const OTHER_TOKEN = "0x2222222222222222222222222222222222222222" as const;
const LABEL_A = pad("0x0a") as Hash;
const LABEL_B = pad("0x0b") as Hash;

let seq = 0;

function note(partial: {
    value: bigint;
    label: Hash;
    tokenId?: string;
    status?: NoteStatus;
}): Note {
    seq += 1;

    return {
        commitment: pad(numberToHex(seq)),
        noteAddressHash: pad("0x01"),
        value: numberToHex(partial.value, { size: 32 }),
        tokenId: (partial.tokenId ?? TOKEN) as Note["tokenId"],
        label: partial.label,
        status: partial.status ?? NoteStatus.ACTIVE,
        createdAtBlock: numberToHex(seq),
        spentAtBlock: null,
        txHash: pad("0xab"),
    } as unknown as Note;
}

describe("selectInputNotes", () => {
    it("selects notes from a single covering label", () => {
        const notes = [note({ value: 100n, label: LABEL_A }), note({ value: 100n, label: LABEL_A })];
        const sel = selectInputNotes({ notes, tokenId: TOKEN, required: 150n });

        expect(sel.label).toBe(LABEL_A);
        expect(sel.commitments).toHaveLength(2);
        expect(sel.total).toBe(200n);
    });

    it("takes largest-first to minimize input count", () => {
        const big = note({ value: 500n, label: LABEL_A });
        const small = note({ value: 1n, label: LABEL_A });
        const sel = selectInputNotes({ notes: [small, big], tokenId: TOKEN, required: 400n });

        expect(sel.commitments).toEqual([big.commitment]);
        expect(sel.total).toBe(500n);
    });

    it("prefers the tightest-fitting covering label", () => {
        const notes = [
            note({ value: 1000n, label: LABEL_A }),
            note({ value: 300n, label: LABEL_B }),
        ];
        const sel = selectInputNotes({ notes, tokenId: TOKEN, required: 250n });

        expect(sel.label).toBe(LABEL_B); // 300 covers 250 tighter than 1000
    });

    it("ignores non-ACTIVE notes and other assets", () => {
        const notes = [
            note({ value: 1000n, label: LABEL_A, status: NoteStatus.PENDING }),
            note({ value: 1000n, label: LABEL_A, tokenId: OTHER_TOKEN }),
            note({ value: 200n, label: LABEL_A }),
        ];
        const sel = selectInputNotes({ notes, tokenId: TOKEN, required: 150n });

        expect(sel.total).toBe(200n);
        expect(sel.commitments).toHaveLength(1);
    });

    it("throws LabelFragmentation when no single label covers", () => {
        const notes = [note({ value: 100n, label: LABEL_A }), note({ value: 100n, label: LABEL_B })];

        try {
            selectInputNotes({ notes, tokenId: TOKEN, required: 150n });
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(LabelFragmentationError);
            const e = err as LabelFragmentationError;

            expect(e.required).toBe(150n);
            expect(e.perLabel).toEqual([
                { label: LABEL_A, spendable: 100n },
                { label: LABEL_B, spendable: 100n },
            ]);
        }
    });

    it("rejects a label that cannot cover within the 5-input cap", () => {
        // six small notes in one label: total 600 >= 500, but needs 6 inputs > cap
        const notes = Array.from({ length: 6 }, () => note({ value: 100n, label: LABEL_A }));

        expect(() => selectInputNotes({ notes, tokenId: TOKEN, required: 550n })).toThrowError(
            LabelFragmentationError,
        );
    });
});
