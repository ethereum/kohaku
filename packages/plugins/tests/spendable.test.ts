import { describe, expect, it } from 'vitest';

import { isSpendable, nearestSpendable, solveSpendable, Spendable, spendableTotal } from '../src/spendable';

const ETH = 10n ** 18n;
const discrete = (...units: Array<[bigint, number]>): Extract<Spendable, { kind: 'discrete' }> => ({
    kind: 'discrete',
    units: units.map(([amount, count]) => ({ amount, count })),
});

describe('discrete', () => {
    const tenPointOnes = discrete([ETH / 10n, 10]);
    const oneEth = discrete([ETH, 1]);
    const mixed = discrete([ETH, 1], [ETH * 3n / 10n, 2], [ETH / 10n, 1]);

    it('reports the total', () => {
        expect(spendableTotal(tenPointOnes)).toBe(ETH);
        expect(spendableTotal(mixed)).toBe(ETH * 17n / 10n);
    });

    it("can't split ten 0.1 notes into 0.25", () => {
        expect(isSpendable(tenPointOnes, ETH / 4n)).toBe(false);
        expect(nearestSpendable(tenPointOnes, ETH / 4n)).toEqual({ below: ETH / 5n, above: ETH * 3n / 10n });
    });

    it("can't take 0.1 out of a 1 ETH note", () => {
        expect(isSpendable(oneEth, ETH / 10n)).toBe(false);
        expect(nearestSpendable(oneEth, ETH / 10n)).toEqual({ below: undefined, above: ETH });
    });

    it('returns the amount itself when it is spendable', () => {
        expect(isSpendable(mixed, ETH * 16n / 10n)).toBe(true);
        expect(nearestSpendable(mixed, ETH * 16n / 10n)).toEqual({ below: ETH * 16n / 10n, above: ETH * 16n / 10n });
    });

    it('finds the nearest amounts across units', () => {
        // Reachable: 0.1 0.3 0.4 0.6 0.7 1 1.1 1.3 1.4 1.6 1.7
        expect(nearestSpendable(mixed, ETH / 2n)).toEqual({ below: ETH * 4n / 10n, above: ETH * 6n / 10n });
        expect(nearestSpendable(mixed, ETH * 9n / 10n)).toEqual({ below: ETH * 7n / 10n, above: ETH });
    });

    it('has nothing above the total and the total below it', () => {
        expect(isSpendable(mixed, 2n * ETH)).toBe(false);
        expect(nearestSpendable(mixed, 2n * ETH)).toEqual({ below: ETH * 17n / 10n, above: undefined });
    });

    it('rejects nonpositive amounts and suggests the smallest note above zero', () => {
        expect(isSpendable(mixed, 0n)).toBe(false);
        expect(isSpendable(mixed, -1n)).toBe(false);
        expect(nearestSpendable(mixed, 0n)).toEqual({ below: undefined, above: ETH / 10n });
    });

    it('solves counts in the units order, preferring larger notes', () => {
        const unsorted = discrete([ETH / 10n, 10], [ETH, 1]);

        expect(solveSpendable(unsorted, ETH)).toEqual([0, 1]);
        expect(solveSpendable(unsorted, ETH * 12n / 10n)).toEqual([2, 1]);
        expect(solveSpendable(unsorted, ETH / 4n)).toBeUndefined();
    });

    it('backtracks out of the greedy choice', () => {
        // 0.12 = 4 × 0.03, not 0.1 + something
        const notes = discrete([ETH / 10n, 1], [ETH * 3n / 100n, 4]);

        expect(solveSpendable(notes, ETH * 12n / 100n)).toEqual([0, 4]);
    });

    it('ignores empty units', () => {
        const notes = discrete([ETH, 0], [ETH / 10n, 2]);

        expect(spendableTotal(notes)).toBe(ETH / 5n);
        expect(solveSpendable(notes, ETH / 5n)).toEqual([0, 2]);
        expect(nearestSpendable(notes, ETH)).toEqual({ below: ETH / 5n, above: undefined });
    });

    it('handles many notes without enumerating them', () => {
        const notes = discrete([100n * ETH, 50], [10n * ETH, 50], [ETH, 50], [ETH / 10n, 50], [ETH / 100n, 50]);
        const odd = 1234n * ETH + 5n * 10n ** 15n; // 1234.005

        expect(nearestSpendable(notes, odd)).toEqual({ below: 1234n * ETH, above: 1234n * ETH + ETH / 100n });
    });
});

describe('continuous', () => {
    const s: Spendable = { kind: 'continuous', max: ETH };

    it('takes anything in (0, max]', () => {
        expect(isSpendable(s, 1n)).toBe(true);
        expect(isSpendable(s, ETH)).toBe(true);
        expect(isSpendable(s, ETH + 1n)).toBe(false);
        expect(isSpendable(s, 0n)).toBe(false);
    });

    it('clamps to max', () => {
        expect(nearestSpendable(s, ETH / 4n)).toEqual({ below: ETH / 4n, above: ETH / 4n });
        expect(nearestSpendable(s, 2n * ETH)).toEqual({ below: ETH, above: undefined });
    });
});
