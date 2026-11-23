import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { asHex, DEFAULT_OUTER, DIGEST, encodeConfig, encodeProof, IDENTIFIER, makeCtx, PARAMS, stackDouble, stackProof, word } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const CONFIG = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, BigInt(DEFAULT_OUTER.validityPeriodInSeconds));

const PROOF = encodeProof(asHex(DEFAULT_OUTER.vkeyHash), asHex(DEFAULT_OUTER.proof), DEFAULT_OUTER.publicInputs.map(asHex), asHex(DEFAULT_OUTER.committedInputs));

const UNTRUSTED = { kind: 'reply-failure', cause: 'material-untrusted' };

const uint16 = fc.integer({ min: 0, max: 65_535 });

const partsArb = fc.tuple(uint16, uint16, uint16);

/** A version word written here: three big-endian uint16, then zeros, in either case. */
const versionWord = ([major, minor, patch]: readonly [number, number, number], upper: boolean): Hex => {
  const digits = `${[major, minor, patch].map((part) => part.toString(16).padStart(4, '0')).join('')}${'0'.repeat(52)}`;

  return `0x${upper ? digits.toUpperCase() : digits}`;
};

const wordArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => bytesToHex(bytes));

/** The reported version, word 0 (the same version half the time), the case of each, and seven other trusted words. */
const caseArb = partsArb.chain((reported) =>
  fc.record({
    reported: fc.constant(reported),
    accepted: fc.oneof(fc.constant(reported), partsArb),
    reportedUpper: fc.boolean(),
    acceptedUpper: fc.boolean(),
    others: fc.array(wordArb, { minLength: 7, maxLength: 7 }),
  }),
);

describe('method-zkpassport accepted-version properties', () => {
  it('configFrom and replyFrom answer material-untrusted exactly where BigInt(params.version) differs from BigInt(trustedKeys[0]), else today\'s bytes', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ reported, accepted, reportedUpper, acceptedUpper, others }) => {
        const version = versionWord(reported, reportedUpper);
        const trustedKeys = [versionWord(accepted, acceptedUpper), ...others];
        const refuses = BigInt(version) !== BigInt(trustedKeys[0] as Hex);
        const method = zkPassportMethod({ stack: stackDouble({ outer: { ...DEFAULT_OUTER, version } }).stack });
        const ctx = makeCtx(CONFIG);
        const params = { ...PARAMS, trustedKeys };
        const enrollment = { result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('outer_evm_count_4')] } };

        expect(await method.configFrom(method.enrollInput(params), enrollment)).toEqual(refuses ? UNTRUSTED : CONFIG);
        expect(await method.replyFrom(ctx, method.signingInput(ctx, params), { proofs: [stackProof('outer_evm_count_5', DIGEST)] })).toEqual(
          refuses ? UNTRUSTED : PROOF,
        );
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});
