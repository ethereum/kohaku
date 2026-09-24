// The two records a client is built from (D-208). Line numbers are
// design/offchain/sdk.md.
import type { Address, Hex, NamedBlockTag } from './chain';

/** The record of one deployment, every field required (D-208 l.1602-1620, l.1636). */
export type DeploymentDescriptor = {
  readonly chainId: number;
  readonly manager: Address;
  readonly methodEcdsa: Address;
  readonly methodPasskey: Address;
  readonly methodAadhaar: Address;
  readonly methodZkpassport: Address;
  readonly action: Address;
  readonly servedImplementation: Address;
  /** The block the manager was deployed in. */
  readonly deployedAt: number;
  readonly digestVersion: string;
  /** The release string, checked against `version()`. */
  readonly managerVersion: string;
  /** The method addresses the kit audited on this chain. */
  readonly shippedMethods: readonly Address[];
  /** The action addresses the kit audited on this chain. */
  readonly auditedActions: readonly Address[];
};

/** A request window's default beside the floor and ceiling of its one entry, in seconds (D-208 l.1624). */
export type RequestWindowBounds = {
  readonly default: number;
  readonly floor: number;
  readonly ceiling: number;
};

/** The account's creation triple and its creation block (D-208 l.1626, D-203 l.752, usage l.418). */
export type CreationRecord = {
  readonly factory: Address;
  readonly bytecode: Hex;
  readonly salt: Hex;
  readonly block: number;
};

/** The tag a read pins at and the tag a watch pins at (D-203 l.829, D-208 l.1629, usage l.419). */
export type BlockTags = {
  readonly read: NamedBlockTag;
  readonly watch: NamedBlockTag;
};

/** What a client accepts (D-208 l.1622-1632). */
export type ClientConfiguration = {
  // The six numbers of D-107 (l.1624), each an exported default the integrator may override.
  /** The default wait a setup screen proposes, in seconds. */
  readonly defaultWait: number;
  /** The wait below which the setup screen warns, in seconds (l.1625). */
  readonly shortWait: number;
  /** The largest wait the SDK accepts, in seconds. */
  readonly maxWait: number;
  readonly requestWindow: RequestWindowBounds;
  /** The cancel gathering's own duration, in seconds. */
  readonly cancelWindow: number;
  /** The rule cost beyond which the SDK refuses, in gas summed over the costliest satisfying set. */
  readonly ruleCostBound: number;
  /** Where the integrator has one (l.1626). */
  readonly creation?: CreationRecord;
  /** The account implementation about to be deployed, read by the fit check alone (l.1627). */
  readonly accountImplementation?: Address;
  /** The integrator's own list, never the account's signer set (l.1628). */
  readonly candidateKeys: readonly Address[];
  readonly blockTags: BlockTags;
  /** The block width `fetch` chunks its reads into (l.1629, D-203 l.761). */
  readonly logChunkSize: number;
  /** The token allowlist (l.1630). */
  readonly tokens: readonly Address[];
  /** The simulation default a prepare's `options.simulate` overrides (l.1631). */
  readonly simulate: boolean;
};
