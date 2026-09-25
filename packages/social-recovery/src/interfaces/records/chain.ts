/** An address as 0x-prefixed hex; a viem `Address` is assignable to it and back. */
export type Address = `0x${string}`;

/** Raw bytes as 0x-prefixed hex. */
export type Hex = `0x${string}`;

/** The named block tags a client configuration pins its reads and watches at. */
export const NAMED_BLOCK_TAGS = ['latest', 'finalized'] as const;

export type NamedBlockTag = (typeof NAMED_BLOCK_TAGS)[number];

/** A named tag, or the block number a pinned read resolved it to. */
export type BlockTag = NamedBlockTag | number;

/** What `block(tag)` answers. */
export type BlockHeader = {
  readonly number: number;
  /** Seconds, the chain time every window and moment is compared against. */
  readonly timestamp: number;
  readonly hash: Hex;
};

/** The block a prepare pinned its reads to. */
export type PinnedBlock = {
  readonly number: number;
  readonly hash: Hex;
};

/** The first and last block `fetch` reads. */
export type BlockRange = {
  readonly from: number;
  readonly to: number;
};

/** One topic position: a value, any of a list, or `null` for a position left open. */
export type FilterTopic = Hex | readonly Hex[] | null;

/** A log filter without a block range. */
export type FilterSpec = {
  readonly address: readonly Address[];
  readonly topics: readonly FilterTopic[];
};

/** Where one log sits, the position every notification carries. */
export type LogPosition = {
  readonly blockNumber: number;
  readonly blockHash: Hex;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly removed: boolean;
};

/** One log as `eth_getLogs` returns it; `removed` where the client library reports one. */
export type RawLog = {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: number;
  readonly blockHash: Hex;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly removed?: boolean;
};

/** The moment a judgment compares against, in seconds; the SDK reads no wall clock. */
export type Moment = number;
