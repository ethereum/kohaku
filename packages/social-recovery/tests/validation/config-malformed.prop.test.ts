import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { passkeyMethod, validateSetup, walletMethod, type Address, type Credential, type IMethodCodec, type MethodReads, type SetupValidationContext } from '../../src/index';
import type { Fields } from '../../src/interfaces';
import { anonAadhaarMethod, zkPassportMethod } from '../../src/recovery-methods';
import { AADHAAR, ECDSA, PASSKEY, SETUP_CONTEXT, ZKPASSPORT, findingsOf, withClauses } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const PROPERTY_TIMEOUT = Math.max(30_000, NUM_RUNS * 20);

const CODECS: ReadonlyMap<Address, IMethodCodec> = new Map([
  [ECDSA, walletMethod().codec],
  [PASSKEY, passkeyMethod().codec],
  [AADHAAR, anonAadhaarMethod().codec],
  [ZKPASSPORT, zkPassportMethod().codec],
]);

const CONTEXT: SetupValidationContext = {
  ...SETUP_CONTEXT,
  methods: SETUP_CONTEXT.methods.map((reads): MethodReads => {
    const codec = CODECS.get(reads.module);

    return codec === undefined ? reads : { ...reads, codec };
  }),
};

const bytesArb = (length: number) => fc.uint8Array({ minLength: length, maxLength: length }).map((bytes) => bytesToHex(bytes));

const wordArb = fc.oneof(fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }), fc.constantFrom(0n, 1n, (1n << 256n) - 1n));

const textArb = fc.string({ unit: 'grapheme', maxLength: 80 });

/** Fields each shipped method's own encodeConfig accepts, tagged with the module that serves it. */
const fieldsArb: fc.Arbitrary<readonly [Address, Fields]> = fc.oneof(
  bytesArb(20).map((signer): readonly [Address, Fields] => [ECDSA, { signer }]),
  fc.record({ x: wordArb, y: wordArb, rpIdHash: bytesArb(32) }).map((fields): readonly [Address, Fields] => [PASSKEY, fields]),
  fc.record({ nullifier: wordArb, nullifierSeed: wordArb, freshnessWindow: wordArb }).map((fields): readonly [Address, Fields] => [AADHAAR, fields]),
  fc
    .record({ uniqueIdentifier: bytesArb(32), domain: textArb, scope: textArb, validityPeriodInSeconds: wordArb })
    .map((fields): readonly [Address, Fields] => [ZKPASSPORT, fields]),
);

const credentialOf = ([module, fields]: readonly [Address, Fields]): Credential => {
  const codec = CODECS.get(module);

  if (codec === undefined) throw new Error(`no codec for ${module}`);

  return { method: module, config: codec.encodeConfig(fields) };
};

describe('credential.config-malformed properties', () => {
  it('a config a shipped method\'s own encodeConfig produced never errs', () => {
    fc.assert(
      fc.property(fieldsArb, (tagged) => {
        const draft = withClauses([{ threshold: 1, credentials: [credentialOf(tagged)] }]);

        expect(findingsOf(validateSetup(draft, CONTEXT), 'credential.config-malformed')).toEqual([]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, PROPERTY_TIMEOUT);

  it('a draft mixing encoded configs of every method across clauses never errs', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fieldsArb, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 3 }), (clauses) => {
        const draft = withClauses(clauses.map((tagged) => ({ threshold: 1, credentials: tagged.map(credentialOf) })));

        expect(findingsOf(validateSetup(draft, CONTEXT), 'credential.config-malformed')).toEqual([]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, PROPERTY_TIMEOUT);
});
