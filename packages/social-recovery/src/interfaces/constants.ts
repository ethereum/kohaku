// The constants this build carries as its own: the two version constants of
// D-204 (design/offchain/sdk.md l.937-943) and the method interface's verify
// ABI with the magic value a verdict must equal (l.404, l.680, l.917).
import type { AbiFunctionItem, Address, Hex } from './records';

/**
 * The digest format's version this build derives typed data under, compared at
 * construction against the domain `eip712Domain()` publishes and never replaced
 * by it (D-200 l.44, D-204 l.941, D-208 l.1653).
 */
export const DIGEST_VERSION = '1';

/**
 * The manager addresses this build's setup body encoder is keyed to (D-204
 * l.942, D-208 l.1654). Empty until a deployment lands, since every address is a
 * placeholder until then (l.1634); how a build maps addresses to an encoder is
 * D-212's open question (l.1768).
 */
export const BODY_ENCODER_KEY: readonly Address[] = [];

/**
 * `IPolicyMethod.verify(config, digest, proof)`, the module's own verification
 * call a page makes through its own provider (design/onchain/contracts.md
 * l.650-651, D-202 l.680).
 */
export const POLICY_METHOD_VERIFY_ABI = [
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      { name: 'config', type: 'bytes' },
      { name: 'digest', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
  },
] as const satisfies readonly AbiFunctionItem[];

/**
 * The one word a verdict must equal: the selector of `verify(bytes,bytes32,bytes)`,
 * the first four bytes of its keccak256, left-aligned in a 32-byte word, compared
 * as a whole word rather than as its first four bytes (D-201 l.404, D-202 l.680,
 * D-204 l.964, contracts.md l.623).
 */
export const VERDICT_MAGIC_VALUE: Hex = '0x024ad31800000000000000000000000000000000000000000000000000000000';
