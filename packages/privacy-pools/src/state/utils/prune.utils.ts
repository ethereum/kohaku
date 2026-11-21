/** Keeps the [key, event] tuples whose event is from `block` or earlier. */
export const keepUpToBlock = <K, E extends { blockNumber: string }>(
  tuples: [K, E][],
  block: bigint,
): [K, E][] => tuples.filter(([, { blockNumber }]) => BigInt(blockNumber) <= block);
