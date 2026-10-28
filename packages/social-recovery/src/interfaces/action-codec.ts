import type { Address, Handover, Hex } from './records';

/** One action's payload layout, as pure functions. */
export interface IActionCodec {
  /** The deployed action contracts this codec serves. */
  readonly actions: readonly Address[];
  encode(handover: Handover): Hex;
  /** Refuses bytes that are not the layout's canonical encoding; judges the layout alone, so a value `encode` would refuse may decode. */
  decode(payload: Hex): Handover;
}
