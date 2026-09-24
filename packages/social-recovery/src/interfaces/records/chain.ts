// Chain values: what the provider answers and what a pinned read carries.
// Line numbers are design/offchain/sdk.md.

/**
 * A 20-byte address as 0x-prefixed hex. The SDK's own type rather than a
 * client library's, since the SDK returns raw bytes and no library's objects
 * (D-200 l.42); a viem `Address` is assignable to it and back.
 */
export type Address = `0x${string}`;

/** Raw bytes as 0x-prefixed hex (D-200 l.42). */
export type Hex = `0x${string}`;

/** The two named tags the client configuration defaults to, read and watch (D-203 l.829, D-208 l.1629). */
export const NAMED_BLOCK_TAGS = ['latest', 'finalized'] as const;

export type NamedBlockTag = (typeof NAMED_BLOCK_TAGS)[number];

/** A named tag, or the block number a pinned read resolved it to (D-201 l.121, D-203 l.745). */
export type BlockTag = NamedBlockTag | number;

/** One block's number, timestamp and hash, what `block(tag)` answers (D-201 l.85, D-208 l.1643). */
export type BlockHeader = {
  readonly number: number;
  /** Seconds, the chain time every window and moment is compared against. */
  readonly timestamp: number;
  readonly hash: Hex;
};

/** The block a prepare pinned its reads to, by number and by hash (D-202 l.558). */
export type PinnedBlock = {
  readonly number: number;
  readonly hash: Hex;
};

/** The two block numbers `fetch` walks, a first and a last, both required (D-203 l.745, usage l.500). */
export type BlockRange = {
  readonly from: number;
  readonly to: number;
};

/** One topic position: a value, any of a list, or `null` for a position left open (D-203 l.737, l.739). */
export type FilterTopic = Hex | readonly Hex[] | null;

/** Addresses and a topics array of hex strings, no block range (D-203 l.737). */
export type FilterSpec = {
  readonly address: readonly Address[];
  readonly topics: readonly FilterTopic[];
};

/** Where one log sits, the position every notification carries (D-203 sketch l.769, l.825). */
export type LogPosition = {
  readonly blockNumber: number;
  readonly blockHash: Hex;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly removed: boolean;
};

/** One log as `eth_getLogs` returns it (D-208 l.1642); `removed` where the client library reports one (l.825). */
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

/** The moment a judgment compares against, in seconds; the SDK reads no wall clock (D-201 l.106, D-205 l.987). */
export type Moment = number;
