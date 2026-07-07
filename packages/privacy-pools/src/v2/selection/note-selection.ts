import { type Address, type Hash, type Note, NoteStatus } from "@privacy-pools-v2/sdk";
import { LabelFragmentationError } from "../interfaces/errors";
import { hexToAmount } from "../mapping/assets";

/**
 * Maximum input notes a single `transact` proof can spend (the `N` in
 * `transact_NxM`, 1..5). A label whose notes cannot cover the target within this
 * many inputs is not usable for the operation.
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
 * their label is ASP-approved). Within a label, notes are taken largest-first to
 * stay within the {@link MAX_INPUTS} circuit cap.
 *
 * When no single approved label can cover `required` (amount + relayer fee)
 * within the input cap, throws {@link LabelFragmentationError} with the per-label
 * spendable breakdown — never silently mixing labels and degrading privacy.
 *
 * @param required amount + relayer fee, in base units.
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
        const spendable = group.reduce((sum, n) => sum + hexToAmount(n.value), 0n);

        perLabel.push({ label, spendable });

        // Largest-first keeps the input count minimal (honors the 5x5 cap).
        const picked: Note[] = [];
        let acc = 0n;

        for (const note of [...group].sort(byValueDesc)) {
            if (acc >= required || picked.length >= MAX_INPUTS) break;

            picked.push(note);
            acc += hexToAmount(note.value);
        }

        if (acc >= required) {
            // Prefer the tightest-fitting covering label to reduce fragmentation over time.
            if (!best || acc < best.total) {
                best = { label, commitments: picked.map((n) => n.commitment), total: acc };
            }
        }
    }

    if (!best) {
        perLabel.sort((a, b) => (a.spendable === b.spendable ? 0 : a.spendable > b.spendable ? -1 : 1));
        throw new LabelFragmentationError(required, perLabel);
    }

    return best;
}
