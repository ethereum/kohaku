import type { AbiEvent } from 'viem';
import type { Address, Hex, IRecoveryMethod } from '../interfaces';

/** An event the reader decodes, with the topic0 its logs carry. */
export type OwnedEvent<Event extends AbiEvent> = {
  readonly event: Event;
  readonly topic0: Hex;
};

/** The `AttemptCancelled` fields `deriveCancelledBy` reads. */
export type CancelFields = {
  readonly account: Address;
  readonly canceller: Address;
  readonly vetoingMethod: Address;
  readonly usedPlaces: readonly bigint[];
};

/** Recovery method implementations, keyed by the module address each serves. */
export type MethodRegistry = ReadonlyMap<Address, IRecoveryMethod>;
