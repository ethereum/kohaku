import type { Address, BlockHeader, Hex, KitNotification, PinnedBlock, RestoreCause, Sender, ValidationResult } from '../interfaces';

/** A block read once: its checked header, and the number and hash every read behind it is pinned to. */
export type PinnedHeader = {
  readonly header: BlockHeader;
  readonly block: PinnedBlock;
};

/** What a refusal carries beside its message. */
export type KitRefusalDetails = {
  /** The findings of the validation that refused. */
  readonly findings?: ValidationResult;
  /** Which step of a restore refused, and the values it refused on. */
  readonly restoreCause?: RestoreCause;
};

/** A decoded setup-committed notification. */
export type SetupCommitted = Extract<KitNotification, { readonly kind: 'setup-committed' }>;

/** A prepared call's members a simulation sends, checked: the target checksummed and the data lower-cased. */
export type CheckedCall = {
  readonly sender: Sender;
  readonly target: Address;
  readonly data: Hex;
};
