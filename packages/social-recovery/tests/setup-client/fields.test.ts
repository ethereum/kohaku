import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { SetupClient, type ClientConfiguration, type DeploymentDescriptor, type IProvider } from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_BAD_CHECKSUM,
  ACTION,
  codecFor,
  CONFIGURATION,
  defaultRegistry,
  defaultWorld,
  DESCRIPTOR,
  doubles,
  KEY_1,
  KEY_2,
  METHOD_A,
} from './doubles';

/** A list of two well-formed addresses with a hole between them. */
const sparse = (first: string, last: string): string[] => {
  const list = new Array<string>(3);

  list[0] = first;
  list[2] = last;

  return list;
};

/** A well-formed creation record. */
const CREATION = {
  factory: getAddress('0x00000000000000000000000000000000000fac01'),
  bytecode: '0x6080',
  salt: `0x${'00'.repeat(32)}`,
  block: 90,
} as const;

/** Builds a client over fresh doubles with one record replaced, answering what it threw and how many provider reads ran. */
function construct(overrides: {
  readonly descriptor?: unknown;
  readonly configuration?: unknown;
  readonly dropProvider?: keyof IProvider;
}): { thrown: unknown; reads: number } {
  const made = doubles(defaultWorld());
  const provider = { ...made.provider } as Partial<IProvider>;

  if (overrides.dropProvider !== undefined) delete provider[overrides.dropProvider];

  try {
    new SetupClient(
      provider as IProvider,
      (overrides.descriptor ?? DESCRIPTOR) as DeploymentDescriptor,
      ACCOUNT,
      ACTION,
      (overrides.configuration ?? CONFIGURATION) as ClientConfiguration,
      made.manager,
      made.action,
      made.events,
      defaultRegistry(),
      codecFor(ACTION),
    );

    return { thrown: undefined, reads: made.seen.provider.length };
  } catch (thrown) {
    return { thrown, reads: made.seen.provider.length };
  }
}

describe('construction-time checks of the consumed fields', () => {
  it('builds over well-formed records with no provider read', () => {
    expect(construct({})).toEqual({ thrown: undefined, reads: 0 });
  });

  it.each([
    ['descriptor.manager not an address', { ...DESCRIPTOR, manager: '0x1234' }],
    ['descriptor.action with a bad checksum', { ...DESCRIPTOR, action: ACCOUNT_BAD_CHECKSUM }],
    ['descriptor.methodEcdsa not a string', { ...DESCRIPTOR, methodEcdsa: 7 }],
    ['descriptor.chainId negative', { ...DESCRIPTOR, chainId: -1 }],
    ['descriptor.deployedAt fractional', { ...DESCRIPTOR, deployedAt: 1.5 }],
    ['descriptor.deployedAt a string', { ...DESCRIPTOR, deployedAt: '100' }],
    ['descriptor.methodPasskey not an address', { ...DESCRIPTOR, methodPasskey: '0xabc' }],
    ['descriptor.methodAadhaar with a bad checksum', { ...DESCRIPTOR, methodAadhaar: ACCOUNT_BAD_CHECKSUM }],
    ['descriptor.methodZkpassport missing', { ...DESCRIPTOR, methodZkpassport: undefined }],
    ['descriptor.servedImplementation not an address', { ...DESCRIPTOR, servedImplementation: '0x' }],
    ['descriptor.shippedMethods not an array', { ...DESCRIPTOR, shippedMethods: METHOD_A }],
    ['descriptor.shippedMethods holding a malformed address', { ...DESCRIPTOR, shippedMethods: [METHOD_A, '0x12'] }],
    ['descriptor.auditedActions holding a bad checksum', { ...DESCRIPTOR, auditedActions: [ACCOUNT_BAD_CHECKSUM] }],
    ['descriptor.managerVersion not a string', { ...DESCRIPTOR, managerVersion: 1 }],
    ['descriptor.digestVersion not decimal', { ...DESCRIPTOR, digestVersion: 'v1' }],
    ['descriptor.digestVersion not a string', { ...DESCRIPTOR, digestVersion: 1 }],
  ])('refuses %s at construction with no provider read', (_name, descriptor) => {
    const { thrown, reads } = construct({ descriptor });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(reads).toBe(0);
  });

  it.each([
    ['configuration.maxWait negative', { ...CONFIGURATION, maxWait: -1 }],
    ['configuration.shortWait unsafe', { ...CONFIGURATION, shortWait: 2 ** 60 }],
    ['configuration.ruleCostBound a string', { ...CONFIGURATION, ruleCostBound: '1' }],
    ['configuration.defaultWait fractional', { ...CONFIGURATION, defaultWait: 0.5 }],
    ['configuration.simulate not a boolean', { ...CONFIGURATION, simulate: 'yes' }],
    ['configuration.candidateKeys not an array', { ...CONFIGURATION, candidateKeys: '0xabc' }],
    ['configuration.candidateKeys holding a malformed address', { ...CONFIGURATION, candidateKeys: ['0x12'] }],
    ['configuration.candidateKeys holding a bad checksum', { ...CONFIGURATION, candidateKeys: [ACCOUNT_BAD_CHECKSUM] }],
    ['configuration.accountImplementation not an address', { ...CONFIGURATION, accountImplementation: '0x1234' }],
    ['configuration.tokens not an array', { ...CONFIGURATION, tokens: 'none' }],
    ['configuration.tokens holding a malformed address', { ...CONFIGURATION, tokens: ['0xzz'] }],
    ['configuration.requestWindow not an object', { ...CONFIGURATION, requestWindow: 3_600 }],
    ['configuration.requestWindow.default negative', { ...CONFIGURATION, requestWindow: { default: -1, floor: 600 } }],
    ['configuration.requestWindow.floor fractional', { ...CONFIGURATION, requestWindow: { default: 3_600, floor: 0.5 } }],
    ['configuration.cancelWindow a string', { ...CONFIGURATION, cancelWindow: '3600' }],
    ['configuration.logChunkSize negative', { ...CONFIGURATION, logChunkSize: -10 }],
    ['configuration.blockTags.watch not a named tag', { ...CONFIGURATION, blockTags: { read: 'latest', watch: 'pending' } }],
    ['configuration.blockTags.read a number', { ...CONFIGURATION, blockTags: { read: 5, watch: 'latest' } }],
    ['configuration.creation not an object', { ...CONFIGURATION, creation: 'yes' }],
    ['configuration.creation.factory not an address', { ...CONFIGURATION, creation: { ...CREATION, factory: '0x12' } }],
    ['configuration.creation.bytecode not hex', { ...CONFIGURATION, creation: { ...CREATION, bytecode: 'code' } }],
    ['configuration.creation.salt not 32 bytes', { ...CONFIGURATION, creation: { ...CREATION, salt: '0x01' } }],
    ['configuration.creation.block negative', { ...CONFIGURATION, creation: { ...CREATION, block: -1 } }],
    ['configuration.candidateKeys repeating one key', { ...CONFIGURATION, candidateKeys: [KEY_1, KEY_2, KEY_1] }],
    ['configuration.candidateKeys naming one key in two spellings', { ...CONFIGURATION, candidateKeys: [KEY_1, KEY_1.toLowerCase()] }],
  ])('refuses %s at construction with no provider read', (_name, configuration) => {
    const { thrown, reads } = construct({ configuration });

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(reads).toBe(0);
  });

  it('accepts a well-formed creation record and a set accountImplementation', () => {
    expect(construct({ configuration: { ...CONFIGURATION, creation: CREATION, accountImplementation: DESCRIPTOR.servedImplementation } })).toEqual({
      thrown: undefined,
      reads: 0,
    });
  });

  it('refuses a digestVersion past the safe integers with a RangeError and no provider read', () => {
    expect(construct({ descriptor: { ...DESCRIPTOR, digestVersion: '9007199254740993' } })).toEqual({
      thrown: expect.any(RangeError),
      reads: 0,
    });
  });

  it.each([
    ['configuration.candidateKeys', { configuration: { ...CONFIGURATION, candidateKeys: new Array(1) } }],
    ['configuration.tokens', { configuration: { ...CONFIGURATION, tokens: sparse(METHOD_A, ACCOUNT) } }],
    ['descriptor.shippedMethods', { descriptor: { ...DESCRIPTOR, shippedMethods: sparse(METHOD_A, ACCOUNT) } }],
    ['descriptor.auditedActions', { descriptor: { ...DESCRIPTOR, auditedActions: new Array(2) } }],
  ])('refuses a hole in %s with a TypeError and no provider read', (_name, overrides) => {
    expect(construct(overrides)).toEqual({ thrown: expect.any(TypeError), reads: 0 });
  });

  it('refuses a hole even where Array.prototype holds a valid address at that index', () => {
    const prototype = Array.prototype as unknown as Record<number, unknown>;

    prototype[1] = KEY_2;

    try {
      expect(construct({ configuration: { ...CONFIGURATION, candidateKeys: sparse(KEY_1, ACCOUNT) } })).toEqual({
        thrown: expect.any(TypeError),
        reads: 0,
      });
    } finally {
      delete prototype[1];
    }

    expect(Object.hasOwn(Array.prototype, 1)).toBe(false);
  });

  it('refuses a logChunkSize of zero with a RangeError and no provider read', () => {
    expect(construct({ configuration: { ...CONFIGURATION, logChunkSize: 0 } })).toEqual({ thrown: expect.any(RangeError), reads: 0 });
  });

  it('accepts a logChunkSize of one', () => {
    expect(construct({ configuration: { ...CONFIGURATION, logChunkSize: 1 } })).toEqual({ thrown: undefined, reads: 0 });
  });

  it('accepts a digestVersion at the largest safe integer', () => {
    expect(construct({ descriptor: { ...DESCRIPTOR, digestVersion: String(Number.MAX_SAFE_INTEGER) } })).toEqual({ thrown: undefined, reads: 0 });
  });

  it.each(['v1', '1.0', '', ' 1'])('refuses a non-decimal digestVersion %j with a TypeError', (digestVersion) => {
    expect(construct({ descriptor: { ...DESCRIPTOR, digestVersion } }).thrown).toBeInstanceOf(TypeError);
  });

  it('refuses a repeated candidate key with a TypeError', () => {
    expect(construct({ configuration: { ...CONFIGURATION, candidateKeys: [KEY_2, KEY_2.toUpperCase().replace('0X', '0x')] } }).thrown).toBeInstanceOf(
      TypeError,
    );
  });

  it('leaves the caller\'s descriptor and configuration objects unchanged, lower-case spellings included', () => {
    const descriptor = { ...DESCRIPTOR, manager: DESCRIPTOR.manager.toLowerCase(), shippedMethods: DESCRIPTOR.shippedMethods.map((entry) => entry.toLowerCase()) };
    const configuration = { ...CONFIGURATION, candidateKeys: CONFIGURATION.candidateKeys.map((key) => key.toLowerCase()), creation: CREATION };
    const descriptorBefore = JSON.stringify(descriptor);
    const configurationBefore = JSON.stringify(configuration);

    expect(construct({ descriptor, configuration })).toEqual({ thrown: undefined, reads: 0 });
    expect(JSON.stringify(descriptor)).toBe(descriptorBefore);
    expect(JSON.stringify(configuration)).toBe(configurationBefore);
  });

  it.each(['block', 'call', 'code', 'transaction'] as const)('refuses a provider without %s at construction', (member) => {
    const { thrown, reads } = construct({ dropProvider: member });

    expect(thrown).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
  });
});
