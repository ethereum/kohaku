import { describe, expect, it } from 'vitest';
import { seed, type Hex } from '../../src/index';
import { approvalGathering, bodyOver, cancellationGathering, METHOD, placeEntry } from './support';

const PLACES = [0, 1, 2].map((p) => placeEntry(p));
const BODY = bodyOver([{ threshold: 1, places: [0] }, { threshold: 1, places: [1, 2] }], PLACES);

/** The members an approval gathering over the three-place body seeds from, with request changes applied. */
function approvalMembers(change: Record<string, unknown> = {}) {
  const { purpose, request } = approvalGathering(PLACES, BODY);

  return { purpose, request: { ...request, ...change } } as Parameters<typeof seed>[0];
}

/** The name of the error a call throws, or 'none'. */
function thrownBy(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return (error as Error).name;
  }

  return 'none';
}

describe('seed refuses malformed digest members', () => {
  it('seeds the well-formed members of both purposes', () => {
    const { purpose, request } = cancellationGathering(PLACES, BODY);

    expect(seed(approvalMembers(), PLACES).replies).toStrictEqual([]);
    expect(seed({ purpose, request }, PLACES).purpose).toBe('cancellation');
  });

  it.each([
    ['an order amount in exponent notation', { order: { token: METHOD, amount: '1e18', payee: METHOD } }],
    ['a negative order amount', { order: { token: METHOD, amount: '-1', payee: METHOD } }],
    ['a digest version that is not a number', { digestVersion: 'x' }],
    ['an empty digest version', { digestVersion: '' }],
    ['an odd-length payload', { payload: '0xabc' }],
    ['a payload that is not hex', { payload: 'abcdef' }],
  ] as [string, Record<string, unknown>][])('throws on %s', (_label, change) => {
    expect(thrownBy(() => seed(approvalMembers(change), PLACES))).toMatch(/^(TypeError|RangeError)$/);
  });

  it.each(['Approval', 'cancel', '', undefined])('throws on the purpose %s', (purpose) => {
    const members = { ...approvalMembers(), purpose } as unknown as Parameters<typeof seed>[0];

    expect(thrownBy(() => seed(members, PLACES))).toMatch(/^(TypeError|RangeError)$/);
  });
});

describe('seed ties each place to the body\'s credential', () => {
  it('throws on a place map built for another body', () => {
    const others = [0, 1, 2].map((p) => placeEntry(p, { config: `0x${(p + 0x10).toString(16)}` as Hex }));

    expect(() => seed(approvalMembers(), others)).toThrow(TypeError);
  });

  it('throws on two places swapped in credential but kept in number', () => {
    const swapped = [PLACES[0]!, { ...PLACES[2]!, place: 1 }, { ...PLACES[1]!, place: 2 }];

    expect(() => seed(approvalMembers(), swapped)).toThrow(TypeError);
  });

  it.each([
    ['method', { method: '0x7777777777777777777777777777777777777777' }],
    ['config', { config: '0x00a3' }],
    ['salt', { salt: `0x${'00'.repeat(31)}09` }],
  ] as [string, Record<string, unknown>][])('throws when one place\'s %s differs', (_label, change) => {
    const places = [PLACES[0]!, { ...PLACES[1]!, ...change }, PLACES[2]!];

    expect(() => seed(approvalMembers(), places as typeof PLACES)).toThrow(TypeError);
  });
});
