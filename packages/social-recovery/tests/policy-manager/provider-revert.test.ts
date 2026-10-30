import { describe, expect, it } from 'vitest';
import { isProviderRevert, type ProviderRevert } from '../../src/index';

describe('isProviderRevert', () => {
  it.each([
    ['empty revert data', { data: '0x' }],
    ['a four-byte selector', { data: '0x912e69d3' }],
    ['upper-case hex digits', { data: '0xDEADBEEF' }],
    ['an Error carrying data', Object.assign(new Error('execution reverted'), { data: '0x08c379a0' })],
    ['an object with other members beside data', { data: '0x01', message: 'reverted', code: 3 }],
  ])('tells a revert from %s', (_case, thrown) => {
    expect(isProviderRevert(thrown)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a hex string itself', '0x08c379a0'],
    ['a number', 3],
    ['an Error without data', new Error('timeout')],
    ['data that is not a string', { data: 1 }],
    ['data of an odd number of digits', { data: '0x123' }],
    ['data without its 0x', { data: 'deadbeef' }],
    ['data with an upper-case 0X', { data: '0Xdeadbeef' }],
    ['data with a non-hex digit', { data: '0xzz' }],
    ['data with trailing text', { data: '0x00 ' }],
    ['a revert record nested one level down', { cause: { data: '0x' } }],
  ])('reads %s as a transport failure', (_case, thrown) => {
    expect(isProviderRevert(thrown)).toBe(false);
  });

  it('narrows to the record so its data is read as hex', () => {
    const thrown: unknown = { data: '0xabcd' };

    if (!isProviderRevert(thrown)) throw new Error('expected a revert');

    const record: ProviderRevert = thrown;

    expect(record.data).toBe('0xabcd');
  });
});
