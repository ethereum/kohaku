import type { Address, Handover, Hex } from './records';

/** One action's payload layout, as pure functions. */
export interface IActionCodec {
  /** The deployed action contracts this codec serves. */
  readonly actions: readonly Address[];
  encode(handover: Handover): Hex;
  /** Refuses bytes its encode would not reproduce. */
  decode(payload: Hex): Handover;
}
