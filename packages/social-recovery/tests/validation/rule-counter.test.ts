import { describe, expect, it } from 'vitest';
import { clausePlaces, decodeSetupBody, filledPerClause, satisfies, type Hex, type SetupBody } from '../../src/index';
import { readVector } from '../kat/read-vector';

/** The blessed setup-body rows, decoded from their expected encodings. */
const rows = new Map(
  readVector('setup-body.json').vectors.map((row) => [row['id'], decodeSetupBody((row.expected as { encoded: Hex }).encoded)]),
);

const row = (name: string): SetupBody => {
  const body = rows.get(name);

  if (body === undefined) throw new Error(`setup-body.json has no row ${name}`);

  return body;
};

describe('the shared rule counter over the blessed setup-body rows', () => {
  it('numbers the places of two-clauses flat across the clauses', () => {
    expect(clausePlaces(row('two-clauses'))).toEqual([[0], [1, 2, 3]]);
  });

  it('numbers no places for empty-clauses and an empty clause for maximum-widths', () => {
    expect(clausePlaces(row('empty-clauses'))).toEqual([]);
    expect(clausePlaces(row('maximum-widths'))).toEqual([[]]);
  });

  it('counts distinct filled places per clause and ignores places past the count', () => {
    expect(filledPerClause(row('two-clauses'), [0, 2, 2, 3, 4, 99])).toEqual([1, 2]);
    expect(filledPerClause(row('two-clauses'), [])).toEqual([0, 0]);
  });

  it('satisfies two-clauses with place 0 and two of places 1 to 3, and not with less', () => {
    const body = row('two-clauses');

    expect(satisfies(body, [0, 1, 3])).toBe(true);
    expect(satisfies(body, [0, 1, 2, 3])).toBe(true);
    expect(satisfies(body, [1, 2, 3])).toBe(false);
    expect(satisfies(body, [0, 3, 4])).toBe(false);
  });

  it('is satisfied by nothing for empty-clauses and for maximum-widths', () => {
    expect(satisfies(row('empty-clauses'), [0, 1])).toBe(false);
    expect(satisfies(row('maximum-widths'), [0])).toBe(false);
  });

  it('is satisfied by nothing for a rule whose every threshold is zero, and by anything beside a nonzero clause', () => {
    const zero: SetupBody = { wait: 0, ignoresPause: false, clauses: [{ threshold: 0, credentials: [`0x${'01'.repeat(32)}`] }] };

    expect(satisfies(zero, [0])).toBe(false);
    expect(satisfies({ ...zero, clauses: [...zero.clauses, { threshold: 1, credentials: [`0x${'02'.repeat(32)}`] }] }, [1])).toBe(true);
  });
});
