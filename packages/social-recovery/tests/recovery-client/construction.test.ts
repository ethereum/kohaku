import { describe, expect, it } from 'vitest';
import type { ClientConfiguration, DeploymentDescriptor } from '../../src/index';
import { CLIENT_CONFIGURATION, CONFIGURATION, DESCRIPTOR, HANDOVER, KEY_NEW, KEY_OLD, METHOD_ECDSA, ORDER, rig, TOKEN, world, type Seen } from './doubles';

const BAD_CHECKSUM = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const isArgumentError = (thrown: unknown): boolean => thrown instanceof TypeError || thrown instanceof RangeError;

/** What the construction threw, beside every read the doubles saw. */
function construct(descriptor: DeploymentDescriptor, configuration: ClientConfiguration = CLIENT_CONFIGURATION): { thrown: unknown; seen: Seen[] } {
  const seen: Seen[] = [];

  try {
    rig(world(), configuration, { descriptor, seen });
  } catch (thrown) {
    return { thrown, seen };
  }

  return { thrown: undefined, seen };
}

const descriptorWith = (member: string, value: unknown): DeploymentDescriptor => ({ ...DESCRIPTOR, [member]: value }) as DeploymentDescriptor;

describe('construction refuses a malformed consumed field with no read', () => {
  it.each([
    ['manager, a bad checksum', 'manager', BAD_CHECKSUM],
    ['manager, a short address', 'manager', '0x1234'],
    ['manager, not a string', 'manager', 7],
    ['action, a bad checksum', 'action', BAD_CHECKSUM],
    ['action, missing', 'action', undefined],
    ['chainId, negative', 'chainId', -1],
    ['chainId, fractional', 'chainId', 1.5],
    ['chainId, past the safe integers', 'chainId', 2 ** 53],
    ['chainId, a decimal string', 'chainId', '11155111'],
    ['deployedAt, negative', 'deployedAt', -1],
    ['deployedAt, a bigint', 'deployedAt', 100n],
    ['digestVersion, a number', 'digestVersion', 1],
    ['digestVersion, empty', 'digestVersion', ''],
    ['digestVersion, not decimal', 'digestVersion', 'v1'],
  ])('descriptor %s', (_name, member, value) => {
    const { thrown, seen } = construct(descriptorWith(member, value));

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '7200'],
    ['past the safe integers', 2 ** 53],
  ])('configuration cancelWindow %s', (_name, value) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, cancelWindow: value as number });

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each(['pending', 7, undefined])('configuration blockTags.read %j', (tag) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, blockTags: { read: tag as 'latest', watch: 'latest' } });

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each([
    ['methodPasskey, a bad checksum', 'methodPasskey', BAD_CHECKSUM],
    ['methodAadhaar, a short address', 'methodAadhaar', '0x1234'],
    ['methodZkpassport, not a string', 'methodZkpassport', 7],
    ['servedImplementation, missing', 'servedImplementation', undefined],
    ['shippedMethods, not an array', 'shippedMethods', METHOD_ECDSA],
    ['shippedMethods, a bad entry', 'shippedMethods', [METHOD_ECDSA, BAD_CHECKSUM]],
    ['auditedActions, a bad entry', 'auditedActions', ['0x1234']],
    ['managerVersion, a number', 'managerVersion', 1],
  ])('descriptor %s', (_name, member, value) => {
    const { thrown, seen } = construct(descriptorWith(member, value));

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each([
    ['accountImplementation, a bad checksum', { accountImplementation: BAD_CHECKSUM }],
    ['tokens, a bad entry', { tokens: [TOKEN, '0x1234'] }],
    ['tokens, not an array', { tokens: TOKEN }],
    ['requestWindow.default, negative', { requestWindow: { default: -1, floor: 3_600 } }],
    ['requestWindow.floor, a string', { requestWindow: { default: 86_400, floor: '3600' } }],
    ['requestWindow, missing', { requestWindow: undefined }],
    ['logChunkSize, fractional', { logChunkSize: 1.5 }],
    ['defaultWait, negative', { defaultWait: -1 }],
    ['shortWait, a string', { shortWait: '60' }],
    ['maxWait, past the safe integers', { maxWait: 2 ** 53 }],
    ['ruleCostBound, a bigint', { ruleCostBound: 1n }],
    ['simulate, a string', { simulate: 'false' }],
    ['blockTags.watch, not a named tag', { blockTags: { read: 'latest', watch: 'pending' } }],
    ['candidateKeys, a bad entry', { candidateKeys: [BAD_CHECKSUM] }],
    ['creation, a short factory', { creation: { factory: '0x1234', bytecode: '0x6080', salt: `0x${'00'.repeat(32)}`, block: 1 } }],
    ['creation, a negative block', { creation: { factory: TOKEN, bytecode: '0x6080', salt: `0x${'00'.repeat(32)}`, block: -1 } }],
    ['creation, a short salt', { creation: { factory: TOKEN, bytecode: '0x6080', salt: '0x00', block: 1 } }],
  ])('configuration %s', (_name, change) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, ...change } as unknown as ClientConfiguration);

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each([
    ['an exact repeat', [KEY_OLD, KEY_OLD]],
    ['two spellings of one key', [KEY_OLD, KEY_OLD.toLowerCase()]],
  ])('a repeated candidate key, %s, throws a TypeError with no read', (_name, candidateKeys) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, candidateKeys: candidateKeys as `0x${string}`[] });

    expect(thrown).toBeInstanceOf(TypeError);
    expect(seen).toEqual([]);
  });

  it('distinct candidate keys and a well-formed creation record construct', () => {
    const configuration = {
      ...CLIENT_CONFIGURATION,
      candidateKeys: [KEY_OLD, KEY_NEW],
      accountImplementation: TOKEN,
      creation: { factory: TOKEN, bytecode: '0x6080' as const, salt: `0x${'00'.repeat(32)}` as const, block: 1 },
    };
    const { thrown, seen } = construct(DESCRIPTOR, configuration);

    expect(thrown).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('construction and an init leave the caller descriptor and configuration unchanged', async () => {
    const descriptor = { ...DESCRIPTOR, manager: DESCRIPTOR.manager.toLowerCase() as `0x${string}`, shippedMethods: [METHOD_ECDSA.toLowerCase() as `0x${string}`] };
    const configuration = { ...CLIENT_CONFIGURATION, tokens: [TOKEN.toLowerCase() as `0x${string}`], candidateKeys: [KEY_NEW.toLowerCase() as `0x${string}`] };
    const descriptorBefore = structuredClone(descriptor);
    const configurationBefore = structuredClone(configuration);
    const { client } = rig(world(), configuration, { descriptor });

    await client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 });
    expect(descriptor).toEqual(descriptorBefore);
    expect(configuration).toEqual(configurationBefore);
  });

  it('descriptor digestVersion past the safe integers throws a RangeError with no read', () => {
    const { thrown, seen } = construct(descriptorWith('digestVersion', '9007199254740993'));

    expect(thrown).toBeInstanceOf(RangeError);
    expect(seen).toEqual([]);
  });

  it('the well-formed descriptor and configuration construct with no read', () => {
    const { thrown, seen } = construct(DESCRIPTOR);

    expect(thrown).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('all-lower and all-upper spellings of the addresses are accepted and come back checksummed in the record', async () => {
    const descriptor = {
      ...DESCRIPTOR,
      manager: DESCRIPTOR.manager.toLowerCase() as `0x${string}`,
      action: `0x${DESCRIPTOR.action.slice(2).toUpperCase()}` as `0x${string}`,
    };
    const { client } = rig(world(), CLIENT_CONFIGURATION, { descriptor });
    const record = await client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 });

    expect(record.request.manager).toBe(DESCRIPTOR.manager);
  });
});

describe('the log chunk size', () => {
  it('zero throws a RangeError at construction with no read', () => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, logChunkSize: 0 });

    expect(thrown).toBeInstanceOf(RangeError);
    expect(seen).toEqual([]);
  });

  it('one constructs', () => {
    expect(construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, logChunkSize: 1 }).thrown).toBeUndefined();
  });
});

describe('a hole in an address list', () => {
  /** A two-entry list whose second slot is a hole. */
  const holed = (first: `0x${string}`): `0x${string}`[] => {
    const list = [first, first];

    delete list[1];

    return list;
  };

  it.each(['candidateKeys', 'tokens'] as const)('configuration %s with a hole throws a TypeError with no read', (member) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, [member]: holed(KEY_OLD) });

    expect(thrown).toBeInstanceOf(TypeError);
    expect(seen).toEqual([]);
  });

  it.each(['shippedMethods', 'auditedActions'] as const)('descriptor %s with a hole throws a TypeError with no read', (member) => {
    const { thrown, seen } = construct(descriptorWith(member, holed(METHOD_ECDSA)));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(seen).toEqual([]);
  });
});

describe('a hole backed by an inherited entry', () => {
  it('a sparse candidateKeys list is refused even with a valid address planted on Array.prototype at the hole', () => {
    const list: `0x${string}`[] = [KEY_OLD, KEY_NEW];

    delete list[1];

    const prototype = Array.prototype as unknown as Record<number, unknown>;

    prototype[1] = KEY_NEW;

    try {
      const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, candidateKeys: list });

      expect(thrown).toBeInstanceOf(TypeError);
      expect(seen).toEqual([]);
    } finally {
      delete prototype[1];
    }
  });
});
