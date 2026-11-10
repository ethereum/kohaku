import fc from 'fast-check';
import * as P256 from 'ox/P256';
import { bytesToHex, numberToHex, size } from 'viem';
import { describe, expect, it } from 'vitest';
import { passkeyMethod, validateSetup, walletMethod, type Address, type Credential, type Hex, type IMethodCodec, type MethodReads, type SetupValidationContext } from '../../src/index';
import type { Fields } from '../../src/interfaces';
import { anonAadhaarMethod, zkPassportMethod } from '../../src/recovery-methods';
import { AADHAAR, ECDSA, PASSKEY, SETUP_CONTEXT, ZKPASSPORT, findingsOf, withClauses } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const PROPERTY_TIMEOUT = Math.max(30_000, NUM_RUNS * 20);

const CODE = 'credential.config-malformed';

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

const credentialOf = ([module, fields]: readonly [Address, Fields]): Credential => {
  const codec = CODECS.get(module);

  if (codec === undefined) throw new Error(`no codec for ${module}`);

  return { method: module, config: codec.encodeConfig(fields) };
};

/** The BN254 scalar field the Aadhaar verifier checks each public input against. */
const BN254_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The shortest freshness window the Aadhaar module accepts, in seconds. */
const AADHAAR_FLOOR = 3_600n;

/** The longest zkPassport validity period the SDK supports, in seconds. */
const ZKPASSPORT_CEILING = 2n ** 53n - 1n;

/** The P-256 base field prime, curve constant and group order. */
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** Whether `(x, y)` is a point of P-256 with both coordinates inside the field, by the curve equation. */
const onP256 = (x: bigint, y: bigint): boolean => x < P256_P && y < P256_P && (y * y - (x * x * x - 3n * x + P256_B)) % P256_P === 0n;

/** Fields for a module beside the fields the chain refuses at every proof, restated here from the modules' rules. */
type Judged = readonly [Address, Fields, readonly string[]];

const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;

/** Sixty-four public keys ox derives from fixed scalars, drawn from a pool since each derivation costs milliseconds. */
const POINTS = Array.from({ length: 64 }, (_, index) => {
  const scalar = (BigInt(index + 1) * 0x9e3779b97f4a7c15f39cc0605cedc835n) % P256_N;
  const { x, y } = P256.getPublicKey({ privateKey: numberToHex(scalar, { size: 32 }) });

  return { x, y };
});

const pointArb = fc.constantFrom(...POINTS);

const keyArb = fc.oneof(
  pointArb,
  pointArb.map(({ x, y }) => ({ x, y: P256_P - y })),
  pointArb.map(({ x, y }) => ({ x, y: y + 1n })),
  pointArb.map(({ y }) => ({ x: P256_P, y })),
  fc.record({ x: wordArb, y: wordArb }),
  fc.constantFrom({ x: 0n, y: 0n }, { x: 1n, y: 2n }),
);

const aadhaarWordArb = fc.oneof(wordArb, fc.bigInt({ min: 0n, max: BN254_FIELD - 1n }), fc.constantFrom(BN254_FIELD - 1n, BN254_FIELD, BN254_FIELD + 1n));

const windowArb = fc.oneof(wordArb, fc.bigInt({ min: 0n, max: 2n * AADHAAR_FLOOR }), fc.constantFrom(AADHAAR_FLOOR - 1n, AADHAAR_FLOOR, 86_400n));

const periodArb = fc.oneof(
  wordArb,
  fc.bigInt({ min: 0n, max: 2n ** 54n }),
  fc.constantFrom(0n, 1n, 604_800n, ZKPASSPORT_CEILING, ZKPASSPORT_CEILING + 1n),
);

const judgedArb: fc.Arbitrary<Judged> = fc.oneof(
  fc.oneof(bytesArb(20), fc.constant<Hex>(`0x${'00'.repeat(20)}`)).map((signer): Judged => [ECDSA, { signer }, BigInt(signer) === 0n ? ['signer'] : []]),
  fc.record({ key: keyArb, rpIdHash: bytesArb(32) }).map(({ key, rpIdHash }): Judged => [PASSKEY, { ...key, rpIdHash }, onP256(key.x, key.y) ? [] : ['x', 'y']]),
  fc.record({ nullifier: aadhaarWordArb, nullifierSeed: aadhaarWordArb, freshnessWindow: windowArb }).map((fields): Judged => [
    AADHAAR,
    fields,
    [
      ...(fields.nullifier >= BN254_FIELD ? ['nullifier'] : []),
      ...(fields.nullifierSeed >= BN254_FIELD ? ['nullifierSeed'] : []),
      ...(fields.freshnessWindow < AADHAAR_FLOOR ? ['freshnessWindow'] : []),
    ],
  ]),
  fc
    .record({ uniqueIdentifier: fc.oneof(bytesArb(32), fc.constant(ZERO_WORD)), domain: textArb, scope: textArb, validityPeriodInSeconds: periodArb })
    .map((fields): Judged => [
      ZKPASSPORT,
      fields,
      [
        ...(BigInt(fields.uniqueIdentifier) === 0n ? ['uniqueIdentifier'] : []),
        ...(fields.validityPeriodInSeconds < 1n || fields.validityPeriodInSeconds > ZKPASSPORT_CEILING ? ['validityPeriodInSeconds'] : []),
      ],
    ]),
);

/** Fields as each shipped enrollment writes them: a nonzero signer, a key on the curve, words inside the field with a 24-hour window, a nonzero identifier with the stack's 604,800-second period. */
const enrolledArb: fc.Arbitrary<readonly [Address, Fields]> = fc.oneof(
  bytesArb(20).filter((signer) => BigInt(signer) !== 0n).map((signer): readonly [Address, Fields] => [ECDSA, { signer }]),
  fc.record({ key: pointArb, rpIdHash: bytesArb(32) }).map(({ key, rpIdHash }): readonly [Address, Fields] => [PASSKEY, { ...key, rpIdHash }]),
  fc
    .record({ nullifier: fc.bigInt({ min: 0n, max: BN254_FIELD - 1n }), nullifierSeed: fc.bigInt({ min: 0n, max: BN254_FIELD - 1n }) })
    .map((words): readonly [Address, Fields] => [AADHAAR, { ...words, freshnessWindow: 86_400n }]),
  fc
    .record({
      uniqueIdentifier: bytesArb(32).filter((identifier) => BigInt(identifier) !== 0n),
      domain: textArb,
      scope: textArb,
      validityPeriodInSeconds: fc.constantFrom<number | bigint>(604_800, 604_800n),
    })
    .map((fields): readonly [Address, Fields] => [ZKPASSPORT, fields]),
);

describe('the bound finding properties', () => {
  it('a decodable config is a bound error exactly when the chain\'s rules refuse a field, naming those fields in layout order', () => {
    fc.assert(
      fc.property(judgedArb, ([module, fields, refused]) => {
        const credential = credentialOf([module, fields]);
        const draft = withClauses([{ threshold: 1, credentials: [credential] }]);
        const values = { place: 0, module, bytes: size(credential.config), reason: 'bound', fields: refused };

        expect(findingsOf(validateSetup(draft, CONTEXT), CODE)).toEqual(refused.length === 0 ? [] : [{ code: CODE, subject: 'credential', values }]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, PROPERTY_TIMEOUT);

  it('configs the shipped enrollments write, side by side, never raise the finding', () => {
    fc.assert(
      fc.property(fc.array(enrolledArb, { minLength: 1, maxLength: 4 }), (tagged) => {
        const draft = withClauses([{ threshold: 1, credentials: tagged.map(credentialOf) }]);

        expect(findingsOf(validateSetup(draft, CONTEXT), CODE)).toEqual([]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, PROPERTY_TIMEOUT);
});
