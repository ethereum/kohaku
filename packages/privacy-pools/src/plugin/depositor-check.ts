import type { Address } from "../interfaces/types.interface";
import type { INote } from "./interfaces/protocol-params.interface";

/** How `prepareUnshield` reacts when the recipient is the depositor of a spendable note. */
export type PPv1DepositorCheckMode = 'warn' | 'block';

export interface PPv1DepositorCheckOptions {
  /** `warn` (default) throws until the caller passes `confirmed: true`; `block` always throws. */
  mode?: PPv1DepositorCheckMode;
  /** Acknowledges the warning raised in `warn` mode. Ignored in `block` mode. */
  confirmed?: boolean;
}

export type PPv1DepositorCheckWarningCode = 'recipient-is-depositor' | 'depositor-unknown';

/** A non-fatal finding of the depositor check, returned on the operation as `warnings`. */
export interface PPv1UnshieldWarning {
  code: PPv1DepositorCheckWarningCode;
  message: string;
}

export type PPv1DepositorCheckResult =
  | { status: 'ok' }
  | { status: 'recipient-is-depositor'; warning: PPv1UnshieldWarning }
  | { status: 'skipped'; warning: PPv1UnshieldWarning };

/**
 * Thrown by `prepareUnshield` when the withdrawal recipient is the address that made
 * the deposit, which links the two ends of the withdrawal and weakens its privacy.
 */
export class PPv1DepositorCheckError extends Error {
  constructor(
    readonly warning: PPv1UnshieldWarning,
    readonly mode: PPv1DepositorCheckMode,
  ) {
    super(
      mode === 'block'
        ? `${warning.message} Withdrawals to the depositor are blocked.`
        : `${warning.message} Pass depositorCheck.confirmed to proceed anyway.`,
    );
    this.name = "PPv1DepositorCheckError";
  }
}

/**
 * Compares the withdrawal recipient against the depositor of the spendable notes.
 * Pure: it only reads the notes it is given. Notes of other assets, spent notes and
 * unapproved notes are ignored.
 */
export function checkDepositor(
  notes: ReadonlyArray<Pick<INote, "assetAddress" | "balance" | "approved"> & { depositor?: Address | null }>,
  asset: Address,
  recipient: Address,
): PPv1DepositorCheckResult {
  const spendable = notes.filter(
    (note) => note.assetAddress === asset && note.approved && note.balance > 0n,
  );

  if (spendable.some((note) => note.depositor != null && note.depositor === recipient)) {
    return {
      status: 'recipient-is-depositor',
      warning: {
        code: 'recipient-is-depositor',
        message: "The withdrawal recipient is the address that deposited into the pool.",
      },
    };
  }

  if (spendable.some((note) => note.depositor == null)) {
    return {
      status: 'skipped',
      warning: {
        code: 'depositor-unknown',
        message: "The depositor check could not run because a note has no depositor.",
      },
    };
  }

  return { status: 'ok' };
}
