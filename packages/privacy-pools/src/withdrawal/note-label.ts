import type { Address } from '../interfaces/types.interface';
import type { INote } from '../plugin/interfaces/protocol-params.interface';

export type PPv1NoteUnavailableReason = 'not-found' | 'wrong-asset' | 'not-approved' | 'insufficient-balance';

/** Thrown when the note chosen with `label` cannot fund the withdrawal. No other note is tried. */
export class PPv1NoteUnavailableError extends Error {
  constructor(
    readonly label: bigint,
    readonly reason: PPv1NoteUnavailableReason,
    /** The note's current balance; absent when the label is not found. */
    readonly balance?: bigint,
    /** Gross amount the note must cover (fees included in exact mode); absent for a full-note withdrawal. */
    readonly required?: bigint,
  ) {
    const detail = reason === 'insufficient-balance'
      ? `: balance ${balance}${required != null ? `, requires ${required}` : ''}`
      : '';

    super(`Note ${label} cannot be spent (${reason})${detail}`);
    this.name = 'PPv1NoteUnavailableError';
  }
}

/**
 * Returns the note with `label` if it is an approved note of `asset` holding at least
 * `amount` (or any positive balance when `amount` is omitted). Throws
 * {@link PPv1NoteUnavailableError} otherwise.
 */
export function selectNoteByLabel(notes: readonly INote[], asset: Address, label: bigint, amount?: bigint): INote {
  const note = notes.find(entry => entry.label === label);

  if (!note) throw new PPv1NoteUnavailableError(label, 'not-found');

  if (note.assetAddress !== asset) throw new PPv1NoteUnavailableError(label, 'wrong-asset', note.balance, amount);

  if (!note.approved) throw new PPv1NoteUnavailableError(label, 'not-approved', note.balance, amount);

  if (note.balance === 0n || (amount != null && note.balance < amount)) {
    throw new PPv1NoteUnavailableError(label, 'insufficient-balance', note.balance, amount);
  }

  return note;
}
