import type { Fields, Hex } from './records';

/** A method's config and proof layouts, as pure functions; each decode refuses bytes its encode would not reproduce. */
export interface IMethodCodec {
  encodeConfig(fields: Fields): Hex;
  decodeConfig(config: Hex): Fields;
  encodeProof(fields: Fields): Hex;
  decodeProof(proof: Hex): Fields;
  /**
   * The config fields, in layout order, whose values the module refuses at every proof or the SDK does not support; empty where every bound holds.
   * Called only on a config `decodeConfig` accepted. The layout stays `decodeConfig`'s, so a refused value still encodes and decodes.
   */
  outOfBounds?(config: Hex): readonly string[];
  /**
   * The first block timestamp, in seconds, at which the module refuses this proof under this config for its age; absent where the method's proofs do not age.
   * Called only on bytes `decodeConfig` and `decodeProof` accept.
   */
  proofExpiry?(config: Hex, proof: Hex): bigint;
}
