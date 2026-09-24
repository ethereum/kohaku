import { getAddress, type AbiEvent } from 'viem';
import type { Address, Hex, LogPosition, RawLog } from '../interfaces';

/** The log's position; `removed` is false when the log omits it. */
export const positionOf = (log: RawLog): LogPosition => ({
  blockNumber: log.blockNumber,
  blockHash: log.blockHash,
  logIndex: log.logIndex,
  transactionHash: log.transactionHash,
  removed: log.removed ?? false,
});

/** One address in its EIP-55 spelling, so every address a notification carries reads one way. */
export const checksummed = (value: Address): Address => getAddress(value);

/**
 * The log's topics as the decoder takes them.
 * Throws when their count is not topic0 plus one per indexed input of the event.
 */
export const topicsFor = (event: AbiEvent, log: RawLog): [Hex, ...Hex[]] => {
  const expected = 1 + event.inputs.filter((input) => input.indexed === true).length;
  const [first, ...rest] = log.topics;

  if (first === undefined || log.topics.length !== expected) {
    throw new Error(
      `A ${event.name} log from ${log.address} carries ${log.topics.length} topics where its layout fixes ${expected}.`,
    );
  }

  return [first, ...rest];
};
