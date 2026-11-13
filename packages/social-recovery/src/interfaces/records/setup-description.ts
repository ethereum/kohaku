import type { Address, Hex } from './chain';
import type { ActionInfo, Parties, ReadResult, RemovedKey } from './manager';
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

/** A shipped identity method's trusted keys by name, decoded from its own declaration in the method's order. */
export type NamedTrustedKeys =
  | {
      readonly kind: 'method-zkpassport';
      /** Word 0, the accepted zkPassport version as `major.minor.patch`. */
      readonly version: string;
      /** Word 1, the root verifier. */
      readonly rootVerifier: Address;
      /** Word 2, the reviewed sub-verifier for that version. */
      readonly subVerifier: Address;
      /** Word 3, the verifier helper the root verifier must return for a proof to pass. */
      readonly verifierHelper: Address;
      /** Word 4, the root registry. */
      readonly rootRegistry: Address;
      /** Word 5, the root verifier's admin as last reviewed. */
      readonly rootAdmin: Address;
      /** Word 6, the root verifier's guardian as last reviewed, the zero address where the root had none. */
      readonly rootGuardian: Address;
      /** Word 7, the sub-verifier's admin as last reviewed. */
      readonly subVerifierAdmin: Address;
    }
  | {
      readonly kind: 'method-aadhaar';
      /** The one word, the issuer's public-key hash. */
      readonly issuerKeyHash: Hex;
    };

/** Per method its self-attested declaration read at this moment, per wallet guardian the address. */
export type DescribedParties = {
  readonly methods: readonly {
    readonly method: Address;
    readonly parties: ReadResult<Parties>;
    /**
     * The declaration's trusted keys by name, addresses checksummed and the hash in lower case. Absent unless the method is the
     * deployment's zkPassport or Aadhaar method and the read was answered with words that method's own acceptance rule passes.
     */
    readonly namedKeys?: NamedTrustedKeys;
  }[];
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

/** The action a setup commits, as its own answer and the deployment name it. */
export type DescribedAction = {
  readonly address: Address;
  /** Its own `actionInfo()` answer (name, version, ERC-165 probe), self-attested, unanswered where that read failed. */
  readonly info: ReadResult<ActionInfo>;
  /** Whether it is the descriptor's own action. */
  readonly shipped: boolean;
  /** Whether the descriptor's audited list names it. */
  readonly audited: boolean;
  /** Its `supportsAccount` answer, absent where the account holds no code yet and the fit is unjudgeable. */
  readonly supportsAccount?: boolean;
};

/** The account's word under its fallback-handler slot. */
export type DescribedFallbackHandler = {
  /** The full word in lower case; all zero means no handler is installed. */
  readonly entry: Hex;
  /** The address the account delegatecalls, the word's low 20 bytes checksummed; absent where they are zero. */
  readonly handler?: Address;
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
  /** Per Aadhaar credential, the freshness window its config holds, in seconds, as held even where validation refuses it. */
  readonly aadhaarWindows: readonly { readonly place: number; readonly freshnessWindow: bigint }[];
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
  /** The action this setup commits, named as the party that holds the account's authority once armed. */
  readonly action: DescribedAction;
  /** Per named method whether it is stopped now and who holds that stop, beside this setup's own choice. */
  readonly pause: {
    readonly ignoresPause: boolean;
    readonly methods: readonly {
      readonly method: Address;
      readonly paused: ReadResult<boolean>;
      readonly pauseHolder: ReadResult<Address>;
    }[];
  };
  /**
   * Code the account keeps under its fallback-handler slot, which a recovery leaves in place.
   * Absent where not read: the account holds no code, the action does not serve it, or the action is not the deployment's.
   */
  readonly fallbackHandler?: ReadResult<DescribedFallbackHandler>;
};
