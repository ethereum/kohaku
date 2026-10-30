import type { AbiFunctionItem, Address, Hex } from '../interfaces/records';

/** The digest format's version this build derives typed data under. */
export const DIGEST_VERSION = '1';

/** The manager addresses this build's setup body encoder is keyed to; empty until a deployment lands. */
export const BODY_ENCODER_KEY: readonly Address[] = [];

/** The ABI of a method module's `verify(config, digest, proof)` view. */
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

/** The word a `verify` result must equal: the `verify(bytes,bytes32,bytes)` selector left-aligned in 32 bytes. */
export const VERDICT_MAGIC_VALUE: Hex = '0x024ad31800000000000000000000000000000000000000000000000000000000';
