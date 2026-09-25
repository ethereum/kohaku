import type { Address, Hex } from './chain';
import type { Parties, ReadResult, RemovedKey } from './manager';
import type { BackupChoice, DraftPrivacy } from './setup';

/** One described credential; it never carries the salt. */
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

/** The clauses a method's credentials share, and how many share each. */
export type FailureDomain = {
  readonly clause: number;
  readonly methods: readonly { readonly method: Address; readonly count: number }[];
};

/** Per method its self-attested declaration read at this moment, per wallet guardian the address. */
export type DescribedParties = {
  readonly methods: readonly { readonly method: Address; readonly parties: ReadResult<Parties> }[];
  readonly walletGuardians: readonly { readonly place: number; readonly address: Address }[];
};

/** A method's tier. */
export const METHOD_TIERS = ['primary', 'secondary'] as const;

export type MethodTier = (typeof METHOD_TIERS)[number];

/** One method's standing. */
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

/** The disclosure the SDK owes a holder about a setup before it is committed. */
export type SetupDescription = {
  readonly rule: { readonly clauses: readonly DescribedClause[] };
  /** In seconds. */
  readonly wait: { readonly committed: number; readonly clientDefault: number };
  readonly failureDomains: readonly FailureDomain[];
  readonly parties: DescribedParties;
  readonly methodStanding: readonly MethodStanding[];
  /** Per passkey credential, the relying-party id hash its config holds. */
  readonly passkeyDomains: readonly { readonly place: number; readonly relyingPartyIdHash: Hex }[];
  /** Per configured candidate key, its `isAuthority` answer. */
  readonly candidateKeys: readonly { readonly key: Address; readonly isAuthority: boolean }[];
  /** The address a handover on this setup would remove. */
  readonly removedKey: RemovedKey;
  readonly privacy: DraftPrivacy;
  readonly backup: { readonly choice: BackupChoice; readonly anySuppliedSalt: boolean };
  /** The places whose supplied salt a submission publishes, the default ones being recomputable by anyone. */
  readonly reveals: { readonly suppliedSaltPlaces: readonly number[] };
  /** Whether anyone ends an attempt through `cancelByVeto` while a method it used is stopped, false where this setup opted out. */
  readonly cancel: { readonly cancelByVeto: boolean };
  /** Whether the account can be upgraded in place, absent where the action's account is not one the SDK knows. */
  readonly upgrade: { readonly upgradeableInPlace?: boolean };
  /** Per named method whether it is stopped now and who holds that stop, beside this setup's own choice. */
  readonly pause: {
    readonly ignoresPause: boolean;
    readonly methods: readonly {
      readonly method: Address;
      readonly paused: ReadResult<boolean>;
      readonly pauseHolder: ReadResult<Address>;
    }[];
  };
};
