import { describe, expect, expectTypeOf, it } from 'vitest';
import { isProviderRevert, type Hex, type ProviderRevert } from '../../src/index';

describe('isProviderRevert', () => {
  it.each([
    ['empty revert data', { data: '0x' }],
    ['an Error(string) selector', { data: '0x08c379a0' }],
    ['upper-case digits', { data: '0xDEADBEEF' }],
    ['mixed-case digits', { data: '0xDeadBeef' }],
    ['an Error carrying data', Object.assign(new Error('execution reverted'), { data: '0x12345678' })],
    ['extra fields beside data', { data: '0x00', code: 3, message: 'reverted' }],
  ])('tells %s as a revert', (_label, thrown) => {
    expect(isProviderRevert(thrown)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', '0x08c379a0'],
    ['a plain Error', new Error('socket hang up')],
    ['an object without data', { message: 'reverted' }],
    ['data that is not a string', { data: 42 }],
    ['data of odd length', { data: '0x123' }],
    ['data without a prefix', { data: '08c379a0' }],
    ['data with an upper-case prefix', { data: '0X08c379a0' }],
    ['data with a non-hex digit', { data: '0x0g' }],
    ['data with surrounding space', { data: ' 0x00' }],
    ['data with a trailing newline', { data: '0x00\n' }],
    ['data nested one level down', { error: { data: '0x00' } }],
  ])('tells %s from a revert', (_label, thrown) => {
    expect(isProviderRevert(thrown)).toBe(false);
  });

  it('narrows to the revert record', () => {
    const thrown: unknown = { data: '0x' };

    if (isProviderRevert(thrown)) expectTypeOf(thrown).toEqualTypeOf<ProviderRevert>();

    expectTypeOf<ProviderRevert>().toEqualTypeOf<{ readonly data: Hex }>();
  });
});
