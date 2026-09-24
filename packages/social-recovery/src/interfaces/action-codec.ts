import type { Address, Handover, Hex } from './records';

/**
 * One action's payload layout, as pure functions (D-201, D-204).
 * `AmbireActionCodec` is the shipped codec.
 */
export interface IActionCodec {
  /** The deployed action contracts this codec serves. */
  readonly actions: readonly Address[];
  encode(handover: Handover): Hex;
  /** Refuses bytes its encode would not reproduce. */
  decode(payload: Hex): Handover;
}
