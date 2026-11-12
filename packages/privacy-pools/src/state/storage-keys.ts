import { Address } from "../interfaces/types.interface";

/**
 * Keys the plugin reads and writes in storage. Their values are JSON whose
 * format belongs to the plugin: route keys where you like, but do not parse
 * or edit the values. Both hold public data, the same for every account.
 */

/**
 * Public chain state. The version is bumped when states saved by earlier
 * versions should be dropped and synced again.
 */
export const getPPv1ChainStateKey = (chainId: bigint, entrypointAddress: Address) =>
  `privacy-pool-state-v2-${chainId}-${entrypointAddress}` as const;

/** Block timestamps that history() interpolates event times from. */
export const getPPv1TimestampsKey = (chainId: bigint, entrypointAddress: Address) =>
  `privacy-pool-timestamps-${chainId}-${entrypointAddress}` as const;
