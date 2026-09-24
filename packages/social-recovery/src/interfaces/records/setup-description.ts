// The setup description, the disclosure I-15 binds to the SDK: thirteen fields
// and `removedKey` (D-205 l.1100-1117). Each field's value carries the facts
// that vary per setup; the constant facts of a row are the ux chapter's words.
// Line numbers are design/offchain/sdk.md.
import type { Address, Hex } from './chain';
import type { Parties, ReadResult, RemovedKey } from './manager';
import type { BackupChoice, DraftPrivacy } from './setup';

/** One described credential: its method and name and its person label, and no salt (l.1104). */
export type DescribedCredential = {
  readonly place: number;
  readonly method: Address;
  /** The module's own name as it said it, absent where `moduleInfo` was not answered. */
  readonly methodName?: string;
  readonly label?: string;
};

export type DescribedClause = {
  readonly threshold: number;
  readonly credentials: readonly DescribedCredential[];
};

/** The clauses a method's credentials share, and how many share each (l.1106). */
export type FailureDomain = {
  readonly clause: number;
  readonly methods: readonly { readonly method: Address; readonly count: number }[];
};

/** Per method its self-attested declaration read at this moment, per wallet guardian the address (l.1107). */
export type DescribedParties = {
  readonly methods: readonly { readonly method: Address; readonly parties: ReadResult<Parties> }[];
  readonly walletGuardians: readonly { readonly place: number; readonly address: Address }[];
};

/** Primary or secondary tier (D-205 l.1108, l.1030). */
export const METHOD_TIERS = ['primary', 'secondary'] as const;

export type MethodTier = (typeof METHOD_TIERS)[number];

/** One method's standing (l.1108). */
export type MethodStanding = {
  readonly method: Address;
  readonly shipped: boolean;
  readonly declaresParties: boolean;
  /** The ERC-165 probe for the method interface, and whether that read was answered. */
  readonly probePassed: ReadResult<boolean>;
  /** Absent where this build cannot place the method in a tier. */
  readonly tier?: MethodTier;
  /** Whether it answers `paused()` with true today, and whether that read was answered. */
  readonly paused: ReadResult<boolean>;
};

export type SetupDescription = {
  readonly rule: { readonly clauses: readonly DescribedClause[] };
  /** The committed wait in seconds, the client's default beside it (l.1105). */
  readonly wait: { readonly committed: number; readonly clientDefault: number };
  readonly failureDomains: readonly FailureDomain[];
  readonly parties: DescribedParties;
  readonly methodStanding: readonly MethodStanding[];
  /** Per passkey credential, the relying-party id hash its config holds (l.1109). */
  readonly passkeyDomains: readonly { readonly place: number; readonly relyingPartyIdHash: Hex }[];
  /** Per configured candidate key, its `isAuthority` answer (l.1110). */
  readonly candidateKeys: readonly { readonly key: Address; readonly isAuthority: boolean }[];
  /** The address a handover on this setup would remove, or the value saying no creation triple was given (l.1111). */
  readonly removedKey: RemovedKey;
  /** The dial value (l.1112). */
  readonly privacy: DraftPrivacy;
  /** The backup choice, and whether any credential carries a salt the holder supplied (l.1113). */
  readonly backup: { readonly choice: BackupChoice; readonly anySuppliedSalt: boolean };
  /** The places whose supplied salt a submission publishes, the default ones being recomputable by anyone (l.1114). */
  readonly reveals: { readonly suppliedSaltPlaces: readonly number[] };
  /** Whether anyone ends an attempt through `cancelByVeto` while a method it used is stopped, false where this setup opted out (l.1115). */
  readonly cancel: { readonly cancelByVeto: boolean };
  /** Whether the account can be upgraded in place, absent where the action's account is not one the SDK knows (l.1116). */
  readonly upgrade: { readonly upgradeableInPlace?: boolean };
  /** Per named method whether it is stopped now and who holds that stop, beside this setup's own choice (l.1117). */
  readonly pause: {
    readonly ignoresPause: boolean;
    readonly methods: readonly {
      readonly method: Address;
      readonly paused: ReadResult<boolean>;
      readonly pauseHolder: ReadResult<Address>;
    }[];
  };
};
