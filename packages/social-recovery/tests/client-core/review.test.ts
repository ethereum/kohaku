import { describe, expect, it } from 'vitest';
import {
  configurationBody,
  configurationCommitment,
  KitRefusalError,
  pinBlockHeader,
  restoreConfiguration,
  simulatePrepared,
  type BlockTag,
  type Configuration,
  type Hex,
  type PreparedBatch,
  type PreparedCall,
} from '../../src/index';
import { pinBlock, resolveBlock } from '../../src/policy-manager/chain';
import { deepFreeze, preparedBatch, preparedCall } from './simulation-fixtures';
import {
  ACCOUNT,
  ACTION,
  actionState,
  BLOCK,
  CONFIGURATION,
  eventsDouble,
  HEADER,
  METHOD_B,
  providerDouble,
  referenceConfigurationCommitment,
  SENDER,
} from './support';

/** `CONFIGURATION` with the credential of the second clause carrying the given salt. */
const withSalt = (salt: unknown): Configuration =>
  ({
    ...CONFIGURATION,
    clauses: [CONFIGURATION.clauses[0], { threshold: 1, credentials: [{ method: METHOD_B, config: '0x', salt }] }],
  }) as unknown as Configuration;

const SALT_PATH = /clauses\[1\]\.credentials\[0\]\.salt/;

describe('a credential salt is absent only when undefined', () => {
  it.each([
    ['null', null],
    ['short hex', '0x1234'],
    ['non-hex', `0x${'zz'.repeat(32)}`],
    ['a number', 0],
    ['a bigint-looking string', '1'],
  ])('refuses a %s salt in configurationBody, configurationCommitment and the restore, naming the member', async (_, salt) => {
    const configuration = withSalt(salt);

    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(TypeError);
    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(SALT_PATH);
    expect(() => configurationCommitment(configuration, ACCOUNT, ACTION, 1n)).toThrow(TypeError);

    const double = eventsDouble([]);
    const committed = referenceConfigurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 1n);
    const thrown = await restoreConfiguration(double.events, ACCOUNT, ACTION, configuration, actionState(committed, 1n), BLOCK).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toBeInstanceOf(KitRefusalError);
  });

  it('an explicitly undefined salt still takes the default', () => {
    expect(configurationBody(withSalt(undefined), ACCOUNT)).toEqual(configurationBody(CONFIGURATION, ACCOUNT));
  });
});

describe('pinBlockHeader refuses a tag outside the named tags', () => {
  it.each(['pending', 'earliest', 'LATEST', -1, 1.5, Number.NaN, null, undefined] as const)('refuses %s before any provider call', async (tag) => {
    const double = providerDouble();

    await expect(pinBlockHeader(double.provider, tag as unknown as BlockTag)).rejects.toThrow(TypeError);
    expect(double.blockTags).toEqual([]);
  });

  it.each(['latest', 'finalized'] as const)('accepts %s', async (tag) => {
    const double = providerDouble();

    await expect(pinBlockHeader(double.provider, tag)).resolves.toMatchObject({ block: { number: HEADER.number } });
    expect(double.blockTags).toEqual([tag]);
  });
});

describe('one block reader for the client and the manager part', () => {
  it('pinBlock and pinBlockHeader read block once each and agree on number and hash', async () => {
    const forPin = providerDouble();
    const forHeader = providerDouble();
    const block = await pinBlock(forPin.provider, 'latest');
    const pinned = await pinBlockHeader(forHeader.provider, 'latest');

    expect(forPin.blockTags).toEqual(['latest']);
    expect(forHeader.blockTags).toEqual(['latest']);
    expect(block).toStrictEqual(pinned.block);
    expect(forPin.calls).toEqual([]);
  });

  it('pinBlock now refuses a header without a timestamp, as pinBlockHeader does', async () => {
    const answer = async () => ({ number: HEADER.number, hash: HEADER.hash });

    await expect(pinBlock(providerDouble(undefined, answer).provider, 'latest')).rejects.toThrow(TypeError);
    await expect(pinBlockHeader(providerDouble(undefined, answer).provider, 'latest')).rejects.toThrow(TypeError);
  });

  it('resolveBlock still returns a passed block without a read and reads once without one', async () => {
    const passed = providerDouble();
    const read = providerDouble();

    await expect(resolveBlock(passed.provider, 'latest', BLOCK)).resolves.toStrictEqual(BLOCK);
    expect(passed.blockTags).toEqual([]);
    await expect(resolveBlock(read.provider, 'finalized', undefined)).resolves.toStrictEqual(BLOCK);
    expect(read.blockTags).toEqual(['finalized']);
  });
});

const describedCall = { target: SENDER, value: 0n, data: '0x' as Hex, block: BLOCK } as unknown as PreparedCall;

describe('simulatePrepared asserts the record kind', () => {
  it.each([
    ['missing', { ...preparedCall('anyone'), kind: undefined }],
    ['Call', { ...preparedCall('anyone'), kind: 'Call' }],
    ['batch with a trailing space', { ...preparedBatch(), kind: 'batch ' }],
    ['a described call', describedCall],
  ])('refuses a kind that is %s with a TypeError naming kind, before any call', async (_, prepared) => {
    const double = providerDouble();
    const result = simulatePrepared(double.provider, prepared as unknown as PreparedCall, ACCOUNT, { simulate: true });

    await expect(result).rejects.toThrow(TypeError);
    await expect(result).rejects.toThrow(/kind/);
    expect(double.calls).toEqual([]);
  });
});

describe('simulatePrepared refuses a call carrying value', () => {
  it.each([
    ['1n', 1n],
    ['a bigint-looking string', '0'],
    ['the number 0', 0],
    ['missing', undefined],
  ])('refuses a value that is %s, on a single call and inside a batch', async (_, value) => {
    const bad = { ...preparedCall('anyone'), value } as unknown as PreparedCall;

    for (const prepared of [bad, preparedBatch([preparedCall('account'), bad])] as const) {
      const double = providerDouble();
      const result = simulatePrepared(double.provider, prepared, ACCOUNT, { simulate: true });

      await expect(result).rejects.toThrow(TypeError);
      await expect(result).rejects.toThrow(/value/);
      expect(double.calls).toEqual([]);
    }
  });

  it('accepts a value of 0n', async () => {
    const double = providerDouble();
    const result = await simulatePrepared(double.provider, preparedCall('anyone'), ACCOUNT, { simulate: true });

    expect(result.simulation).toStrictEqual({ success: true });
  });
});

describe('simulatePrepared checks the record even with the simulation off', () => {
  const foreignBlock = preparedBatch([preparedCall('account'), preparedCall('account', '0x01', { number: BLOCK.number + 1, hash: BLOCK.hash })]);
  const malformed: readonly (readonly [string, PreparedCall | PreparedBatch])[] = [
    ['a batch with a foreign inner block', foreignBlock],
    ['a record with no kind', { ...preparedCall('anyone'), kind: undefined } as unknown as PreparedCall],
    ['a batch with a malformed call', preparedBatch([preparedCall('account'), { ...preparedCall('account'), target: '0x12' }])],
    ['a call with a malformed target', { ...preparedCall('anyone'), target: '0x12' }],
    ['a call with a non-zero value', { ...preparedCall('anyone'), value: 1n }],
    ['a call with a malformed block', { ...preparedCall('anyone'), block: { number: -1, hash: BLOCK.hash } }],
  ];

  it.each(malformed)('refuses %s under simulate false, with no provider call', async (_, prepared) => {
    for (const [configuration, options] of [
      [{ simulate: true }, { simulate: false }],
      [{ simulate: false }, undefined],
    ] as const) {
      const double = providerDouble();

      await expect(simulatePrepared(double.provider, prepared, ACCOUNT, configuration, options)).rejects.toThrow();
      expect(double.calls).toEqual([]);
    }
  });

  it('still returns a well-formed record unchanged and unsimulated', async () => {
    const double = providerDouble();
    const batch = deepFreeze(preparedBatch([preparedCall('account'), preparedCall('anyone', '0x02')]));

    await expect(simulatePrepared(double.provider, batch, ACCOUNT, { simulate: false })).resolves.toEqual(batch);
    expect(double.calls).toEqual([]);
  });

  it('an options.from ignored on an account-sent call does not refuse with the simulation off', async () => {
    const double = providerDouble();

    await expect(
      simulatePrepared(double.provider, preparedCall('account'), ACCOUNT, { simulate: false }, { from: '0x12' }),
    ).resolves.toEqual(preparedCall('account'));
  });
});
