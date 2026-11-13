import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { encodeConfig, encodeProof, stackDouble, word } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const { codec } = zkPassportMethod({ stack: stackDouble().stack });

const wordArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => bytesToHex(bytes));

const validityArb = fc.bigInt({ min: 0n, max: (1n << 256n) - 1n });

/** The codec's member, failing where the codec carries none. */
const proofExpiry = (config: Hex, proof: Hex): bigint => {
  if (codec.proofExpiry === undefined) throw new Error('the zkPassport codec carries no proofExpiry');

  return codec.proofExpiry(config, proof);
};

const proofOf = (publicInputs: readonly Hex[]): Hex => encodeProof(word(0x63), '0x1234', publicInputs, '0x');

describe('method-zkpassport proof-expiry properties', () => {
  it('a proof of eight or more public inputs expires at its input 2 plus the config\'s period', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 8, maxLength: 16 }), validityArb, (publicInputs, validity) => {
        const config = encodeConfig(word(7), 'recover.example', 'mast-social-recovery', validity);

        expect(proofExpiry(config, proofOf(publicInputs))).toBe(BigInt(publicInputs[2] as Hex) + validity);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('a proof of fewer than eight public inputs is a RangeError, whatever the period', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { maxLength: 7 }), validityArb, (publicInputs, validity) => {
        const config = encodeConfig(word(7), 'recover.example', 'mast-social-recovery', validity);

        expect(() => proofExpiry(config, proofOf(publicInputs))).toThrow(RangeError);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});
