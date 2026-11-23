import { size } from 'viem';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { describeSetup, passkeyMethod, validateSetup, VALIDATION_CONFIG_FAULTS, walletMethod, type Address, type Credential, type Hex, type IMethodCodec, type MethodReads, type SetupValidationContext } from '../../src/index';
import { anonAadhaarMethod, zkPassportMethod } from '../../src/recovery-methods';
import { CONTEXT as DESCRIPTION_CONTEXT, DRAFT as DESCRIPTION_DRAFT, ECDSA as DESCRIPTION_ECDSA, withMethod } from '../description/setup-fixtures';
import { readVector } from '../kat/read-vector';
import { AADHAAR, ECDSA, PASSKEY, SETUP_CONTEXT, UNSHIPPED, ZKPASSPORT, findingsOf, withClauses } from './fixtures';

const CODE = 'credential.config-malformed';

/** Each shipped method's codec, by the fixture module it serves. */
const CODECS: ReadonlyMap<Address, IMethodCodec> = new Map([
  [ECDSA, walletMethod().codec],
  [PASSKEY, passkeyMethod().codec],
  [AADHAAR, anonAadhaarMethod().codec],
  [ZKPASSPORT, zkPassportMethod().codec],
]);

/** The codec a reads entry carries. */
type ReadsCodec = NonNullable<MethodReads['codec']>;

/** The fixture context with every shipped module's reads carrying its method's codec. */
const withCodecs = (codecs: ReadonlyMap<Address, ReadsCodec> = CODECS): SetupValidationContext => ({
  ...SETUP_CONTEXT,
  methods: SETUP_CONTEXT.methods.map((reads): MethodReads => {
    const codec = codecs.get(reads.module);

    return codec === undefined ? reads : { ...reads, codec };
  }),
});

const encodedOf = (file: string, row = 0): Hex => {
  const found = readVector(file).vectors[row];

  if (found === undefined) throw new Error(`${file} has no row ${row}`);

  return (found.expected as { readonly encoded: Hex }).encoded;
};

const AADHAAR_CONFIG = encodedOf('method-aadhaar-config.json');
const WALLET_CONFIG = encodedOf('method-ecdsa-config.json');
const WALLET_ZERO_CONFIG = encodedOf('method-ecdsa-config.json', 1);
const PASSKEY_CONFIG = encodedOf('method-passkey-config.json');
const ZKPASSPORT_CONFIG = encodedOf('method-zkpassport-config.json');

/** The byte length the finding names, viem's `size` of the config. */
const bytesOf = (config: Hex): number => size(config);

/** The one finding the validator should raise for `config` at `place` under `module`. */
const malformed = (place: number, module: Address, config: Hex) => ({
  code: CODE,
  subject: 'credential',
  values: { place, module, bytes: bytesOf(config), reason: 'layout' },
});

/** The finding for a config that decodes but holds `fields` its module refuses at every proof. */
const outOfBounds = (place: number, module: Address, config: Hex, fields: readonly string[]) => ({
  code: CODE,
  subject: 'credential',
  values: { place, module, bytes: bytesOf(config), reason: 'bound', fields },
});

/** `config` with its 32-byte word at `index` replaced by `value`. */
const withWord = (config: Hex, index: number, value: bigint): Hex =>
  `${config.slice(0, 2 + 64 * index)}${value.toString(16).padStart(64, '0')}${config.slice(2 + 64 * (index + 1))}` as Hex;

/** The BN254 scalar field the Aadhaar verifier checks every public input against. */
const BN254_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const oneClause = (credentials: readonly Credential[]) => withClauses([{ threshold: 1, credentials }]);

const BAD: readonly (readonly [string, Address, Hex])[] = [
  ['a 64-byte Aadhaar config, the layout before the freshness window', AADHAAR, AADHAAR_CONFIG.slice(0, 2 + 128) as Hex],
  ['a 95-byte Aadhaar config', AADHAAR, AADHAAR_CONFIG.slice(0, -2) as Hex],
  ['a 97-byte Aadhaar config', AADHAAR, `${AADHAAR_CONFIG}00`],
  ['a zkPassport config with a trailing word, not canonical', ZKPASSPORT, `${ZKPASSPORT_CONFIG}${'00'.repeat(32)}`],
  ['a zkPassport config one word short', ZKPASSPORT, ZKPASSPORT_CONFIG.slice(0, -64) as Hex],
  ['a two-word passkey config', PASSKEY, PASSKEY_CONFIG.slice(0, 2 + 128) as Hex],
  ['a four-word passkey config', PASSKEY, `${PASSKEY_CONFIG}${'00'.repeat(32)}`],
  ['a 20-byte wallet config, the bare address', ECDSA, `0x${WALLET_CONFIG.slice(-40)}`],
  ['a wallet word with dirty high bytes', ECDSA, `0x${'ff'.repeat(12)}${WALLET_CONFIG.slice(-40)}`],
];

const GOOD: readonly (readonly [string, Address, Hex])[] = [
  ['the Aadhaar vector', AADHAAR, AADHAAR_CONFIG],
  ['the wallet vector', ECDSA, WALLET_CONFIG],
  ['the passkey vector', PASSKEY, PASSKEY_CONFIG],
  ['the zkPassport vector', ZKPASSPORT, ZKPASSPORT_CONFIG],
  ['an upper-case wallet config', ECDSA, `0x${WALLET_CONFIG.slice(2).toUpperCase()}`],
];

/** Configs that decode but hold a value their module refuses at every proof, with the fields refused. */
const BOUND: readonly (readonly [string, Address, Hex, readonly string[]])[] = [
  ['the wallet zero-address vector, refused at enrollment', ECDSA, WALLET_ZERO_CONFIG, ['signer']],
  ['an Aadhaar config whose window is one second, under the floor the verify keeps', AADHAAR, `0x${AADHAAR_CONFIG.slice(2, -64)}${'00'.repeat(31)}01`, ['freshnessWindow']],
  ['an Aadhaar config whose nullifier is the circuit field', AADHAAR, withWord(AADHAAR_CONFIG, 0, BN254_FIELD), ['nullifier']],
  [
    'an Aadhaar config whose every word is out of bounds',
    AADHAAR,
    withWord(withWord(withWord(AADHAAR_CONFIG, 0, BN254_FIELD), 1, BN254_FIELD), 2, 0n),
    ['nullifier', 'nullifierSeed', 'freshnessWindow'],
  ],
  ['a zkPassport config with a zero identifier', ZKPASSPORT, withWord(ZKPASSPORT_CONFIG, 0, 0n), ['uniqueIdentifier']],
  ['a zkPassport config with a zero validity period', ZKPASSPORT, withWord(ZKPASSPORT_CONFIG, 3, 0n), ['validityPeriodInSeconds']],
  ['a zkPassport config whose period is 2^53 seconds', ZKPASSPORT, withWord(ZKPASSPORT_CONFIG, 3, 2n ** 53n), ['validityPeriodInSeconds']],
  ['a passkey config whose key is (1, 2), off the curve', PASSKEY, withWord(withWord(PASSKEY_CONFIG, 0, 1n), 1, 2n), ['x', 'y']],
];

describe('credential.config-malformed in the pure validateSetup', () => {
  it.each(BAD)('%s is one error naming its place, module and byte length', (_why, module, config) => {
    const result = validateSetup(oneClause([{ method: module, config }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([malformed(0, module, config)]);
    expect(result.errors).toContainEqual(malformed(0, module, config));
    expect(result.warnings.map((finding) => finding.code)).not.toContain(CODE);
  });

  it.each(GOOD)('%s raises nothing', (_why, module, config) => {
    expect(findingsOf(validateSetup(oneClause([{ method: module, config }]), withCodecs()), CODE)).toEqual([]);
  });

  it('every shipped vector side by side raises nothing', () => {
    const draft = oneClause(GOOD.map(([, method, config]) => ({ method, config })));

    expect(findingsOf(validateSetup(draft, withCodecs()), CODE)).toEqual([]);
  });

  it('raises exactly one error per bad place, counted across clauses, the good places untouched', () => {
    const [aadhaar, , , zk, , passkey, , wallet] = BAD;
    const draft = withClauses([
      { threshold: 1, credentials: [{ method: ECDSA, config: WALLET_CONFIG }, { method: AADHAAR, config: aadhaar![2] }] },
      { threshold: 2, credentials: [{ method: PASSKEY, config: PASSKEY_CONFIG }, { method: ZKPASSPORT, config: zk![2] }, { method: PASSKEY, config: passkey![2] }] },
      { threshold: 1, credentials: [{ method: ECDSA, config: wallet![2] }] },
    ]);

    expect(findingsOf(validateSetup(draft, withCodecs()), CODE)).toEqual([
      malformed(1, AADHAAR, aadhaar![2]),
      malformed(3, ZKPASSPORT, zk![2]),
      malformed(4, PASSKEY, passkey![2]),
      malformed(5, ECDSA, wallet![2]),
    ]);
  });

  it('one malformed config at two places is two errors beside the duplicate', () => {
    const bare: Hex = `0x${WALLET_CONFIG.slice(-40)}`;
    const result = validateSetup(oneClause([{ method: ECDSA, config: bare }, { method: PASSKEY, config: PASSKEY_CONFIG }, { method: ECDSA, config: bare }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([malformed(0, ECDSA, bare), malformed(2, ECDSA, bare)]);
    expect(findingsOf(result, 'credential.duplicate')).toHaveLength(1);
  });

  it('judges a module only by the codec its own reads carry', () => {
    const twoWords = PASSKEY_CONFIG.slice(0, 2 + 128) as Hex;
    const onlyWallet = withCodecs(new Map([[ECDSA, walletMethod().codec]]));
    const result = validateSetup(oneClause([{ method: PASSKEY, config: twoWords }, { method: ECDSA, config: twoWords }]), onlyWallet);

    expect(findingsOf(result, CODE)).toEqual([malformed(1, ECDSA, twoWords)]);
  });

  it('an unshipped module whose reads carry no codec is not judged, its warnings unchanged', () => {
    const draft = oneClause([{ method: UNSHIPPED, config: '0x01' }]);
    const result = validateSetup(draft, withCodecs());

    expect(findingsOf(result, CODE)).toEqual([]);
    expect(result).toEqual(validateSetup(draft, SETUP_CONTEXT));
  });

  it('hands each credential\'s config to its module\'s decodeConfig, and any throw is the finding', () => {
    const decodeConfig = vi.fn((config: Hex) => {
      if (config === '0x02') throw 'not an Error';

      return {};
    });
    const result = validateSetup(oneClause([{ method: ECDSA, config: '0x01' }, { method: ECDSA, config: '0x02' }]), withCodecs(new Map([[ECDSA, { decodeConfig }]])));

    expect(decodeConfig.mock.calls.map(([config]) => config).sort()).toEqual(['0x01', '0x02']);
    expect(findingsOf(result, CODE)).toEqual([malformed(1, ECDSA, '0x02')]);
  });
});

/** A codec that decodes as `module`'s shipped codec does and answers the bounds with `outOfBounds`. */
const decodingAs = (module: Address, bounds: unknown): ReadsCodec => {
  const shipped = CODECS.get(module);

  if (shipped === undefined) throw new Error(`no codec for ${module}`);

  return { decodeConfig: (config: Hex) => shipped.decodeConfig(config), outOfBounds: bounds } as unknown as ReadsCodec;
};

describe('credential.config-malformed for a config that decodes but its module refuses at every proof', () => {
  it.each(BOUND)('%s is one bound error naming its place, module, byte length and fields', (_why, module, config, fields) => {
    const result = validateSetup(oneClause([{ method: module, config }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([outOfBounds(0, module, config, fields)]);
    expect(result.errors).toContainEqual(outOfBounds(0, module, config, fields));
    expect(result.warnings.map((finding) => finding.code)).not.toContain(CODE);
  });

  it('an Aadhaar credential a 2-of-2 clause needs, its window one second, is an error before commitment', () => {
    const oneSecond = withWord(AADHAAR_CONFIG, 2, 1n);
    const draft = withClauses([{ threshold: 2, credentials: [{ method: ECDSA, config: WALLET_CONFIG }, { method: AADHAAR, config: oneSecond }] }]);

    expect(anonAadhaarMethod().codec.decodeConfig(oneSecond)).toMatchObject({ freshnessWindow: 1n });
    expect(validateSetup(draft, withCodecs()).errors).toContainEqual(outOfBounds(1, AADHAAR, oneSecond, ['freshnessWindow']));
  });

  it.each(BAD)('%s stays a layout error alone: outOfBounds is never asked', (_why, module, config) => {
    const bounds = vi.fn(() => ['never']);
    const result = validateSetup(oneClause([{ method: module, config }]), withCodecs(new Map([[module, decodingAs(module, bounds)]])));

    expect(findingsOf(result, CODE)).toEqual([malformed(0, module, config)]);
    expect(bounds).not.toHaveBeenCalled();
  });

  it('a codec with decodeConfig alone is judged on layout only, as before', () => {
    const bare: Hex = `0x${WALLET_CONFIG.slice(-40)}`;
    const layoutOnly = withCodecs(new Map([[ECDSA, { decodeConfig: (config: Hex) => walletMethod().codec.decodeConfig(config) }]]));
    const result = validateSetup(oneClause([{ method: ECDSA, config: WALLET_ZERO_CONFIG }, { method: ECDSA, config: bare }]), layoutOnly);

    expect(findingsOf(result, CODE)).toEqual([malformed(1, ECDSA, bare)]);
  });

  it('asks outOfBounds for each place whose config decodes, and an empty answer is no finding', () => {
    const bare: Hex = `0x${WALLET_CONFIG.slice(-40)}`;
    const bounds = vi.fn<(config: Hex) => readonly string[]>(() => []);
    const draft = oneClause([{ method: ECDSA, config: WALLET_CONFIG }, { method: ECDSA, config: bare }, { method: ECDSA, config: WALLET_ZERO_CONFIG }]);
    const result = validateSetup(draft, withCodecs(new Map([[ECDSA, decodingAs(ECDSA, bounds)]])));

    expect(bounds.mock.calls.map(([config]) => config).sort()).toEqual([WALLET_CONFIG, WALLET_ZERO_CONFIG].sort());
    expect(findingsOf(result, CODE)).toEqual([malformed(1, ECDSA, bare)]);
  });

  it('hands a non-empty answer on as the finding\'s fields', () => {
    const result = validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), withCodecs(new Map([[ECDSA, decodingAs(ECDSA, () => ['first', 'second'])]])));

    expect(findingsOf(result, CODE)).toEqual([outOfBounds(0, ECDSA, WALLET_CONFIG, ['first', 'second'])]);
  });

  it.each([
    ['throws an Error', () => {
      throw new Error('bounds unknown');
    }],
    ['throws a value that is not an Error', () => {
      throw 'bounds unknown';
    }],
    ['returns undefined', () => undefined],
    ['returns null', () => null],
    ['returns a string', () => 'signer'],
    ['returns an object', () => ({ fields: ['signer'] })],
    ['returns an array holding a number', () => [1]],
    ['returns an array mixing a name and a number', () => ['signer', 1]],
  ])('an outOfBounds that %s is a bound error with no fields, the module not vouching for the config', (_why, bounds) => {
    const result = validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), withCodecs(new Map([[ECDSA, decodingAs(ECDSA, bounds)]])));

    expect(findingsOf(result, CODE)).toEqual([outOfBounds(0, ECDSA, WALLET_CONFIG, [])]);
  });

  it('raises one error per place, counted across clauses, layout and bound side by side', () => {
    const [aadhaar] = BAD;
    const oneSecond = withWord(AADHAAR_CONFIG, 2, 1n);
    const zeroIdentifier = withWord(ZKPASSPORT_CONFIG, 0, 0n);
    const draft = withClauses([
      { threshold: 1, credentials: [{ method: ECDSA, config: WALLET_ZERO_CONFIG }, { method: AADHAAR, config: oneSecond }] },
      { threshold: 2, credentials: [{ method: PASSKEY, config: PASSKEY_CONFIG }, { method: ZKPASSPORT, config: zeroIdentifier }, { method: AADHAAR, config: aadhaar![2] }] },
      { threshold: 1, credentials: [{ method: ECDSA, config: WALLET_CONFIG }] },
    ]);

    expect(findingsOf(validateSetup(draft, withCodecs()), CODE)).toEqual([
      outOfBounds(0, ECDSA, WALLET_ZERO_CONFIG, ['signer']),
      outOfBounds(1, AADHAAR, oneSecond, ['freshnessWindow']),
      outOfBounds(3, ZKPASSPORT, zeroIdentifier, ['uniqueIdentifier']),
      malformed(4, AADHAAR, aadhaar![2]),
    ]);
  });

  it('the zero signer at two places is two errors beside the duplicate', () => {
    const result = validateSetup(oneClause([{ method: ECDSA, config: WALLET_ZERO_CONFIG }, { method: PASSKEY, config: PASSKEY_CONFIG }, { method: ECDSA, config: WALLET_ZERO_CONFIG }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([outOfBounds(0, ECDSA, WALLET_ZERO_CONFIG, ['signer']), outOfBounds(2, ECDSA, WALLET_ZERO_CONFIG, ['signer'])]);
    expect(findingsOf(result, 'credential.duplicate')).toHaveLength(1);
  });

  it('every finding\'s reason is one of VALIDATION_CONFIG_FAULTS, layout or bound', () => {
    const draft = oneClause([...BAD, ...BOUND].map(([, method, config]) => ({ method, config })));
    const reasons = findingsOf(validateSetup(draft, withCodecs()), CODE).map((finding) => (finding.values as { readonly reason?: unknown }).reason);

    expect([...VALIDATION_CONFIG_FAULTS]).toEqual(['layout', 'bound']);
    expect(reasons).toHaveLength(BAD.length + BOUND.length);
    expect(reasons.every((reason) => (VALIDATION_CONFIG_FAULTS as readonly unknown[]).includes(reason))).toBe(true);
  });

  it('the reads\' codec type carries decodeConfig and the bounds hook', () => {
    expectTypeOf<ReadsCodec>().toEqualTypeOf<Pick<IMethodCodec, 'decodeConfig' | 'outOfBounds'>>();
  });
});

const NOT_A_BOUNDS: readonly (readonly [string, unknown])[] = [
  ['a string', 'bounds'],
  ['a number', 42],
  ['null', null],
];

/** The reads entry the pure validator names in its TypeError for a module's bounds hook. */
const boundsPath = (module: Address): RegExp =>
  new RegExp(`context\\.methods\\[${SETUP_CONTEXT.methods.findIndex((reads) => reads.module === module)}\\]\\.codec\\.outOfBounds`);

describe('a codec whose outOfBounds is present but not a function', () => {
  it.each(NOT_A_BOUNDS)('%s on the reads is a TypeError naming the reads entry, never a finding', (_why, bounds) => {
    const context = withCodecs(new Map([[ECDSA, decodingAs(ECDSA, bounds)]]));

    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(TypeError);
    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(boundsPath(ECDSA));
  });

  it.each(NOT_A_BOUNDS)('%s is a TypeError even on the reads of a module the draft does not name', (_why, bounds) => {
    const context = withCodecs(new Map([[ECDSA, walletMethod().codec], [ZKPASSPORT, decodingAs(ZKPASSPORT, bounds)]]));

    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(TypeError);
    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(boundsPath(ZKPASSPORT));
  });
});

describe('the byte length the finding names', () => {
  it('is viem\'s size of the config, zero for the empty config', () => {
    const result = validateSetup(oneClause([{ method: ECDSA, config: '0x' }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([{ code: CODE, subject: 'credential', values: { place: 0, module: ECDSA, bytes: size('0x'), reason: 'layout' } }]);
    expect(size('0x')).toBe(0);
  });

  it.each([
    ['an odd-length config', '0x123'],
    ['an un-prefixed config', '1234'],
  ])('%s never reaches the codec: the draft guard refuses it with a TypeError first', (_why, config) => {
    const decodeConfig = vi.fn(() => ({}));

    expect(() => validateSetup(oneClause([{ method: ECDSA, config: config as Hex }]), withCodecs(new Map([[ECDSA, { decodeConfig }]])))).toThrow(TypeError);
    expect(decodeConfig).not.toHaveBeenCalled();
  });
});

describe('reads without a codec', () => {
  it.each(BAD)('%s raises nothing when the reads carry no codec', (_why, module, config) => {
    expect(findingsOf(validateSetup(oneClause([{ method: module, config }]), SETUP_CONTEXT), CODE)).toEqual([]);
  });

  it.each(BOUND)('%s raises nothing when the reads carry no codec', (_why, module, config) => {
    expect(findingsOf(validateSetup(oneClause([{ method: module, config }]), SETUP_CONTEXT), CODE)).toEqual([]);
  });

  it('the fixture draft gives the same answer with and without codecs, its configs being 32-byte words a wallet decodes', () => {
    const wallets = oneClause([{ method: ECDSA, config: WALLET_CONFIG }, { method: AADHAAR, config: AADHAAR_CONFIG }]);

    expect(validateSetup(wallets, withCodecs())).toEqual(validateSetup(wallets, SETUP_CONTEXT));
  });
});

/** The reads entry the pure validator names in its TypeError for a module's codec. */
const codecPath = (module: Address): RegExp => new RegExp(`context\\.methods\\[${SETUP_CONTEXT.methods.findIndex((reads) => reads.module === module)}\\]\\.codec`);

const NOT_A_DECODER: readonly (readonly [string, unknown])[] = [
  ['an empty codec', {}],
  ['a decodeConfig that is a string', { decodeConfig: 'decode' }],
  ['a codec that is a number', 42],
  ['a codec that is a string', 'codec'],
  ['a null codec', null],
];

describe('a codec without a decodeConfig function', () => {
  it.each(NOT_A_DECODER)('%s on the reads is a TypeError naming the reads entry, never a finding', (_why, codec) => {
    const context = withCodecs(new Map([[ECDSA, codec as Pick<IMethodCodec, 'decodeConfig'>]]));

    expect(SETUP_CONTEXT.methods.some((reads) => reads.module === ECDSA)).toBe(true);
    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(TypeError);
    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(codecPath(ECDSA));
  });

  it('is a TypeError even on the reads of a module the draft does not name', () => {
    const context = withCodecs(new Map([[ZKPASSPORT, {} as unknown as Pick<IMethodCodec, 'decodeConfig'>]]));

    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(TypeError);
    expect(() => validateSetup(oneClause([{ method: ECDSA, config: WALLET_CONFIG }]), context)).toThrow(codecPath(ZKPASSPORT));
  });
});

describe('describeSetup over reads whose codec is not a decoder', () => {
  const plain = describeSetup(DESCRIPTION_DRAFT, DESCRIPTION_CONTEXT);

  it.each(NOT_A_DECODER)('%s is accepted, the description unchanged, as it never reads the codec', (_why, codec) => {
    const context = withMethod(DESCRIPTION_ECDSA, { codec } as unknown as Partial<MethodReads>);

    expect(context.methods.find((reads) => reads.module === DESCRIPTION_ECDSA)).toHaveProperty('codec', codec);
    expect(describeSetup(DESCRIPTION_DRAFT, context)).toEqual(plain);
  });

  it('a working codec on the reads changes nothing either, the description judging no config', () => {
    const decodeConfig = vi.fn(() => ({}));
    const context = withMethod(DESCRIPTION_ECDSA, { codec: { decodeConfig } });

    expect(describeSetup(DESCRIPTION_DRAFT, context)).toEqual(plain);
    expect(decodeConfig).not.toHaveBeenCalled();
  });
});
