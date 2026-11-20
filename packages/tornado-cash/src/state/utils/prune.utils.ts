/** Keeps the [key, event] tuples whose event is from before `block`. */
export const keepBeforeBlock = <K, E extends { blockNumber: string }>(
  tuples: [K, E][],
  block: bigint,
): [K, E][] => tuples.filter(([, { blockNumber }]) => BigInt(blockNumber) < block);
