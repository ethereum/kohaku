import type { Address, Hex, NamedBlockTag } from './chain';

/** The record of one deployment on one chain. */
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
  /** The method addresses audited on this chain. */
  readonly shippedMethods: readonly Address[];
  /** The action addresses audited on this chain. */
  readonly auditedActions: readonly Address[];
};

/** A request window's default and bounds, in seconds. */
export type RequestWindowBounds = {
  readonly default: number;
  readonly floor: number;
  readonly ceiling: number;
};

/** How and in which block the account was created. */
export type CreationRecord = {
  readonly factory: Address;
  readonly bytecode: Hex;
  readonly salt: Hex;
  readonly block: number;
};

/** The tag a read pins at and the tag a watch pins at. */
export type BlockTags = {
  readonly read: NamedBlockTag;
  readonly watch: NamedBlockTag;
};

/** The configuration a client is built with. */
export type ClientConfiguration = {
  /** The default wait a setup screen proposes, in seconds. */
  readonly defaultWait: number;
  /** The wait below which the setup screen warns, in seconds. */
  readonly shortWait: number;
  /** The largest wait the SDK accepts, in seconds. */
  readonly maxWait: number;
  readonly requestWindow: RequestWindowBounds;
  /** The cancel gathering's own duration, in seconds. */
  readonly cancelWindow: number;
  /** The rule cost beyond which the SDK refuses, in gas summed over the costliest satisfying set. */
  readonly ruleCostBound: number;
  /** The account's creation record, where the integrator has one. */
  readonly creation?: CreationRecord;
  /** The account implementation about to be deployed. */
  readonly accountImplementation?: Address;
  /** The integrator's own list, never the account's signer set. */
  readonly candidateKeys: readonly Address[];
  readonly blockTags: BlockTags;
  /** The block width `fetch` chunks its reads into. */
  readonly logChunkSize: number;
  /** The token allowlist. */
  readonly tokens: readonly Address[];
  /** The simulation default a prepare's `options.simulate` overrides. */
  readonly simulate: boolean;
};
