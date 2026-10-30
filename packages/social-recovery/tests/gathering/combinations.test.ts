import { describe, expect, it } from 'vitest';
import { combinations } from '../../src/gathering/choose';

const FOUR: readonly string[] = ['a', 'b', 'c', 'd'];

describe('combinations', () => {
  it('yields its first subset of 10 among 20 promptly, having read only those ten items', () => {
    const items = Array.from({ length: 20 }, (_v, i) => `m${i}`);
    let reads = 0;
    const counted = new Proxy(items, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^[0-9]+$/.test(key)) reads++;

        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const started = performance.now();
    const first = combinations(counted, 10).next();

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(first.done).toBe(false);
    expect(first.value).toStrictEqual(items.slice(0, 10));
    expect(reads).toBe(10);
  });

  it('is a generator, not an array', () => {
    const produced = combinations(FOUR, 2);

    expect(Array.isArray(produced)).toBe(false);
    expect(typeof produced.next).toBe('function');
  });

  it.each([
    [0, [[]]],
    [1, [['a'], ['b'], ['c'], ['d']]],
    [2, [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd']]],
    [3, [['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'c', 'd'], ['b', 'c', 'd']]],
    [4, [['a', 'b', 'c', 'd']]],
    [5, []],
  ] as [number, string[][]][])('four items taken %i at a time come out in the former eager order', (size, expected) => {
    expect([...combinations(FOUR, size)]).toStrictEqual(expected);
  });

  it('every yielded subset is its own array', () => {
    const all = [...combinations(FOUR, 2)];

    all[0]!.push('z');

    expect(all[1]).toStrictEqual(['a', 'c']);
    expect(new Set(all).size).toBe(all.length);
  });
});
