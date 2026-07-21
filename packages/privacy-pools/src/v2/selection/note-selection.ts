import { type Address, type Hash, type Note, NoteStatus } from "@0xbow-io/privacy-pools-v2-sdk";
import { LabelFragmentationError } from "../interfaces/errors";
import { hexToAmount } from "../mapping/assets";

/**
 * Maximum input notes a single `transact` spends — the SDK's circuit max.
 * Inputs and outputs are independent circuit dimensions: selection is
 * single-label (INV-5), so outputs are at most 2 (recipient + change)
 * regardless of input count, and the `transact_5x2`/`5x1` artifacts ship in
 * the default manifest.
 */
const MAX_INPUTS = 5;

/** The chosen input notes for a transact, all from one label (INV-5). */
export type SelectedInputs = {
    /** The single label all selected notes share. */
    label: Hash;
    /** Commitments to pass as `PrepareTransactBase.inputCommitments`. */
    commitments: Hash[];
    /** Summed value of the selected notes (>= required). */
    total: bigint;
};

/** Descending-by-value bigint comparator (largest first). */
function byValueDesc(a: Note, b: Note): number {
    const av = hexToAmount(a.value);
    const bv = hexToAmount(b.value);

    return av === bv ? 0 : av > bv ? -1 : 1;
}

/**
 * Select input notes for a transfer/withdraw, enforcing per-label value
 * conservation (INV-5, FR-023): all inputs share one label and are ACTIVE (i.e.
 * their label is ASP-approved). Strategy: take the **4 largest** notes of the
 * label with the highest 4-note sum. Because that is the most any single label
 * can put into one `transact`, if those 4 cannot cover `required` then no single
 * label can — so we fail with {@link LabelFragmentationError} carrying each
 * label's 4-note spendable. The caller sizes `required` (e.g. amount only) and
 * verifies the relayer fee against the resulting change after the SDK returns its
 * quotes.
 */
export function selectInputNotes(params: {
    notes: readonly Note[];
    tokenId: Address;
    required: bigint;
}): SelectedInputs {
    const { notes, tokenId, required } = params;

    const byLabel = new Map<Hash, Note[]>();

    for (const note of notes) {
        if (note.status !== NoteStatus.ACTIVE) continue;

        if (note.tokenId.toLowerCase() !== tokenId.toLowerCase()) continue;

        const group = byLabel.get(note.label);

        if (group) group.push(note);
        else byLabel.set(note.label, [note]);
    }

    const perLabel: Array<{ label: Hash; spendable: bigint }> = [];
    let best: SelectedInputs | null = null;

    for (const [label, group] of byLabel) {
        // The 4 largest notes: the most this label can spend in one transact.
        const top = [...group].sort(byValueDesc).slice(0, MAX_INPUTS);
        const total = top.reduce((sum, n) => sum + hexToAmount(n.value), 0n);

        perLabel.push({ label, spendable: total });

        // Pick the label whose 4-largest sum is greatest — the global best a single
        // label can do, so "if these can't cover, none can" holds.
        if (total >= required && (!best || total > best.total)) {
            best = { label, commitments: top.map((n) => n.commitment), total };
        }
    }

    if (!best) {
        perLabel.sort((a, b) => (a.spendable === b.spendable ? 0 : a.spendable > b.spendable ? -1 : 1));
        throw new LabelFragmentationError(required, perLabel);
    }

    return best;
}
