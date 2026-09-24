import { describe, expect, it } from 'vitest';
import { REPLY_FAILURE_CAUSES, walletMethod, type EnrollInput, type Hex } from '../../src/index';
import { addressWord, SIGNER_ONE, ZERO_ADDRESS } from './fixtures';

const method = walletMethod();

const expectEnrollFailure = (result: unknown): void => {
  expect(typeof result).toBe('object');
  expect(result).toMatchObject({ kind: 'reply-failure' });
  expect(REPLY_FAILURE_CAUSES).toContain((result as { cause: string }).cause);
  expect((result as { cause: string }).cause).toBe('material-rejected');
};

describe('enrollInput({ address })', () => {
  it('returns the nothing-to-perform input carrying the address', () => {
    const input = method.enrollInput({ address: SIGNER_ONE });

    expect(input.kind).toBe('nothing-to-perform');
    expect(input['address']).toBe(SIGNER_ONE);
  });

  it('is pure: two calls with the same params give equal inputs', () => {
    expect(method.enrollInput({ address: SIGNER_ONE })).toStrictEqual(method.enrollInput({ address: SIGNER_ONE }));
  });
});

describe('configFrom(input, undefined)', () => {
  it('returns the address as config bytes, one ABI-encoded address', async () => {
    const config = await method.configFrom(method.enrollInput({ address: SIGNER_ONE }), undefined);

    expect(typeof config).toBe('string');
    expect((config as Hex).toLowerCase()).toBe(addressWord(SIGNER_ONE));
  });

  it('accepts an all-lower-case address', async () => {
    const lower = SIGNER_ONE.toLowerCase();
    const config = await method.configFrom(method.enrollInput({ address: lower }), undefined);

    expect((config as Hex).toLowerCase()).toBe(addressWord(SIGNER_ONE));
  });

  it('writes the bytes the codec decodes back to the same address', async () => {
    const config = (await method.configFrom(method.enrollInput({ address: SIGNER_ONE }), undefined)) as Hex;

    expect(String(method.codec.decodeConfig(config)['signer']).toLowerCase()).toBe(SIGNER_ONE.toLowerCase());
  });

  it('reads the address off a hand-built nothing-to-perform input', async () => {
    const input: EnrollInput = { kind: 'nothing-to-perform', address: SIGNER_ONE };

    expect(((await method.configFrom(input, undefined)) as Hex).toLowerCase()).toBe(addressWord(SIGNER_ONE));
  });

  it.each([
    ['missing', {}],
    ['numeric', { address: 42 }],
    ['a bigint', { address: 0x7e5f4552091a69125d5dfcb7b8c2659029395bdfn }],
    ['null', { address: null }],
    ['too short', { address: '0x1234' }],
    ['21 bytes', { address: `${SIGNER_ONE}00` }],
    ['no 0x prefix', { address: SIGNER_ONE.slice(2) }],
    ['non-hex characters', { address: `0x${'zz'.repeat(20)}` }],
    ['the 32-byte config word itself', { address: addressWord(SIGNER_ONE) }],
    ['empty string', { address: '' }],
  ])('an address that is %s is an EnrollFailure, not a throw', async (_label, params) => {
    const call = method.configFrom(method.enrollInput(params), undefined);

    await expect(call).resolves.toBeDefined();
    expectEnrollFailure(await call);
  });

  it('the zero address is an EnrollFailure, though the codec still encodes it', async () => {
    const call = method.configFrom(method.enrollInput({ address: ZERO_ADDRESS }), undefined);

    await expect(call).resolves.toBeDefined();
    expectEnrollFailure(await call);
    expect(method.codec.encodeConfig({ signer: ZERO_ADDRESS })).toBe(addressWord(ZERO_ADDRESS));
  });

  it('a bare nothing-to-perform input with no address is an EnrollFailure', async () => {
    expectEnrollFailure(await method.configFrom({ kind: 'nothing-to-perform' }, undefined));
  });

  it('a ceremony input, which this method never produces, is an EnrollFailure rather than a throw', async () => {
    expectEnrollFailure(await method.configFrom({ kind: 'ceremony' }, undefined));
  });
});
