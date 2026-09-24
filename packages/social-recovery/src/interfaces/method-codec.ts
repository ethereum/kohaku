import type { Fields, Hex } from './records';

/**
 * A method's config and proof layouts, as pure functions; each decode refuses
 * bytes its encode would not reproduce (D-201, D-204).
 */
export interface IMethodCodec {
  encodeConfig(fields: Fields): Hex;
  decodeConfig(config: Hex): Fields;
  encodeProof(fields: Fields): Hex;
  decodeProof(proof: Hex): Fields;
}
