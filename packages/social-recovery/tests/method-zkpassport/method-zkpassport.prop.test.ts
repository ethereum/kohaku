import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Hex } from '../../src/interfaces';
import * as constants from '../../src/constants';
import {
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeFiveFieldConfig,
  encodeNestedConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  outerInputs,
  PARAMS,
  stackDouble,
  stackProof,
  word,
} from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const { codec } = zkPassportMethod({ stack: stackDouble().stack });

const bytesArb = (minLength: number, maxLength: number) => fc.uint8Array({ minLength, maxLength }).map((bytes) => bytesToHex(bytes));

const wordArb = bytesArb(32, 32);

const textArb = fc.string({ unit: 'grapheme', maxLength: 80 });

const configArb = fc.record({
  uniqueIdentifier: wordArb,
  domain: textArb,
  scope: textArb,
  validityPeriodInSeconds: fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }),
});

const proofArb = fc.record({
  vkeyHash: wordArb,
  proof: bytesArb(0, 300),
  publicInputs: fc.array(wordArb, { maxLength: 12 }),
  committedInputs: bytesArb(0, 200),
});

describe('method-zkpassport codec properties', () => {
  it('config: the codec encodes as viem encodes the pin\'s signature, and decodes back to the fields', () => {
    fc.assert(
      fc.property(configArb, (fields) => {
        const expected = encodeConfig(fields.uniqueIdentifier, fields.domain, fields.scope, fields.validityPeriodInSeconds);

        expect(codec.encodeConfig(fields)).toBe(expected);
        expect(codec.decodeConfig(expected)).toEqual(fields);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('config: the same fields in the five-field or the nested layout are refused', () => {
    fc.assert(
      fc.property(configArb, wordArb, (fields, version) => {
        const { uniqueIdentifier, domain, scope, validityPeriodInSeconds } = fields;

        expect(() => codec.decodeConfig(encodeFiveFieldConfig(uniqueIdentifier, version, domain, scope, validityPeriodInSeconds))).toThrow();
        expect(() => codec.decodeConfig(encodeNestedConfig(uniqueIdentifier, domain, scope, validityPeriodInSeconds))).toThrow();
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('proof: the codec encodes as viem encodes the proof layout, and decodes back to the fields', () => {
    fc.assert(
      fc.property(proofArb, ({ vkeyHash, proof, publicInputs, committedInputs }) => {
        const expected = encodeProof(vkeyHash, proof, publicInputs, committedInputs);
        const fields = { proofVerificationData: { vkeyHash, proof, publicInputs }, committedInputs };

        expect(codec.encodeProof(fields)).toBe(expected);

        const decoded = codec.decodeProof(expected);

        expect(decoded).toEqual(fields);
        expect(codec.encodeProof(decoded)).toBe(expected);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('proof: a hole anywhere in publicInputs is refused with a TypeError naming its position', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 12 }), fc.nat(), (inputs, at) => {
        const position = at % inputs.length;
        const holed: Hex[] = inputs.slice();

        delete holed[position];

        let error: unknown;

        try {
          codec.encodeProof({ proofVerificationData: { vkeyHash: inputs[0] as Hex, proof: '0x', publicInputs: holed }, committedInputs: '0x' });
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(TypeError);
        expect((error as Error).message).toContain(`[${position}]`);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});

describe('method-zkpassport proof-list properties', () => {
  const other = stackProof('sig_check_dsc');
  const enrollOuter = stackProof('outer_evm_count_4');
  const replyOuter = stackProof('outer_evm_count_5', DIGEST);
  const config = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, BigInt(DEFAULT_OUTER.validityPeriodInSeconds));

  /** A list of `length` with the outer proof at one position and a hole at another, the rest unrelated proofs. */
  const holedArb = fc
    .integer({ min: 2, max: 8 })
    .chain((length) => fc.tuple(fc.constant(length), fc.nat({ max: length - 1 }), fc.nat({ max: length - 1 })))
    .filter(([, outerAt, holeAt]) => outerAt !== holeAt);

  const holed = (length: number, outerAt: number, holeAt: number, outer: typeof other): (typeof other)[] => {
    const list = Array.from({ length }, (_, index) => (index === outerAt ? outer : other));

    delete list[holeAt];

    return list;
  };

  it('a hole at any position of the proofs answers material-rejected at configFrom and replyFrom, and the stack is not called', async () => {
    await fc.assert(
      fc.asyncProperty(holedArb, async ([length, outerAt, holeAt]) => {
        const double = stackDouble();
        const method = zkPassportMethod({ stack: double.stack });
        const ctx = makeCtx(config);
        const material = { result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: holed(length, outerAt, holeAt, enrollOuter) } };

        expect(await method.configFrom(method.enrollInput(PARAMS), material)).toEqual(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED);
        expect(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { proofs: holed(length, outerAt, holeAt, replyOuter) })).toEqual(
          constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED,
        );
        expect(double.calls).toEqual([]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});

describe('method-zkpassport nullifier-type properties', () => {
  const config = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, BigInt(DEFAULT_OUTER.validityPeriodInSeconds));
  const rejected = constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  it('over nullifier types 0 to 4 and both modes, enrollment, reply and verify accept exactly type 0, and type 2 in dev mode', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), fc.boolean(), async (type, devMode) => {
        const outer = { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER, BigInt(type)) };
        const double = stackDouble({ outer });
        const method = zkPassportMethod({ stack: double.stack, devMode });
        const ctx = makeCtx(config);
        const proof = encodeProof(outer.vkeyHash as Hex, outer.proof as Hex, outer.publicInputs as Hex[], outer.committedInputs as Hex);
        const accepted = type === 0 || (type === 2 && devMode);
        const enrollment = { result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('outer_evm_count_4')] } };
        const reply = { proofs: [stackProof('outer_evm_count_5', DIGEST)] };

        expect(await method.configFrom(method.enrollInput(PARAMS), enrollment)).toEqual(accepted ? config : rejected);
        expect(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), reply)).toEqual(accepted ? proof : rejected);
        expect(await method.verify(ctx, proof)).toBe(accepted ? 'not-judged' : 'rejected');
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});
