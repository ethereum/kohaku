import { size } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { describeSetup, passkeyMethod, validateSetup, walletMethod, type Address, type Credential, type Hex, type IMethodCodec, type MethodReads, type SetupValidationContext } from '../../src/index';
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

/** The fixture context with every shipped module's reads carrying its method's codec. */
const withCodecs = (codecs: ReadonlyMap<Address, Pick<IMethodCodec, 'decodeConfig'>> = CODECS): SetupValidationContext => ({
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
  values: { place, module, bytes: bytesOf(config) },
});

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
  ['the wallet zero-address vector, refused at enrollment, not here', ECDSA, WALLET_ZERO_CONFIG],
  ['the passkey vector', PASSKEY, PASSKEY_CONFIG],
  ['the zkPassport vector', ZKPASSPORT, ZKPASSPORT_CONFIG],
  ['an Aadhaar config whose window is one second, under the floor the verify keeps', AADHAAR, `0x${AADHAAR_CONFIG.slice(2, -64)}${'00'.repeat(31)}01`],
  ['an upper-case wallet config', ECDSA, `0x${WALLET_CONFIG.slice(2).toUpperCase()}`],
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

describe('the byte length the finding names', () => {
  it('is viem\'s size of the config, zero for the empty config', () => {
    const result = validateSetup(oneClause([{ method: ECDSA, config: '0x' }]), withCodecs());

    expect(findingsOf(result, CODE)).toEqual([{ code: CODE, subject: 'credential', values: { place: 0, module: ECDSA, bytes: size('0x') } }]);
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
