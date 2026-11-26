/** `count` notes of `amount` each. */
export type SpendableUnit = {
    amount: bigint;
    count: number;
};

/**
 * Which amounts of an asset can actually be unshielded, without listing them.
 * Returned by `balance()` next to the total when it differs from what a single
 * unshield can take.
 */
export type Spendable =
    /** Any amount in (0, max]. Notes with arbitrary values. */
    | { kind: 'continuous'; max: bigint }
    /**
     * Any Σ cᵢ·amountᵢ with 0 ≤ cᵢ ≤ countᵢ, cᵢ not all zero. Fixed-denomination
     * notes. Units are sorted from the largest to the smallest amount.
     */
    | { kind: 'discrete'; units: SpendableUnit[] };

export type DiscreteSpendable = Extract<Spendable, { kind: 'discrete' }>;

/** The nearest amounts that can be unshielded, `below ≤ amount ≤ above`. */
export type NearestSpendable = {
    /** Undefined when nothing positive is reachable at or below the amount. */
    below?: bigint;
    /** Undefined when the amount is above everything reachable. */
    above?: bigint;
};

const gcd = (a: bigint, b: bigint) => {
    while (b !== 0n) [a, b] = [b, a % b];

    return a;
};

/** Units with something to spend, from the largest to the smallest amount. */
const usableUnits = (units: SpendableUnit[]) => units
    .filter(({ amount, count }) => amount > 0n && count > 0)
    .sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0);

/** Capacity and gcd of each suffix of `units`. */
function suffixes(units: SpendableUnit[]) {
    const capacity = Array<bigint>(units.length + 1).fill(0n);
    const divisor = [...capacity];

    for (let index = units.length - 1; index >= 0; index--) {
        const { amount, count } = units[index]!;

        capacity[index] = capacity[index + 1]! + amount * BigInt(count);
        divisor[index] = gcd(amount, divisor[index + 1]!);
    }

    return { capacity, divisor };
}

/** Total of the notes `spendable` describes. */
export function spendableTotal(spendable: Spendable): bigint {
    if (spendable.kind === 'continuous') return spendable.max > 0n ? spendable.max : 0n;

    return spendable.units.reduce((sum, { amount, count }) => amount > 0n && count > 0 ? sum + amount * BigInt(count) : sum, 0n);
}

/**
 * How many notes of each unit sum exactly to `amount`, in the order of
 * `spendable.units`, or undefined if no combination does. Prefers larger
 * notes: the first combination found takes as many of the largest unit as fit.
 */
export function solveSpendable(spendable: DiscreteSpendable, amount: bigint): number[] | undefined {
    if (amount <= 0n) return undefined;

    const units = usableUnits(spendable.units);
    const { capacity, divisor } = suffixes(units);
    const failed = units.map(() => new Set<bigint>());

    const search = (index: number, remaining: bigint): number[] | undefined => {
        if (remaining === 0n) return Array<number>(units.length - index).fill(0);

        if (index === units.length || remaining > capacity[index]! || remaining % divisor[index]! !== 0n || failed[index]!.has(remaining)) return undefined;

        const { amount: unit, count } = units[index]!;
        const maxCount = Number(remaining / unit < BigInt(count) ? remaining / unit : BigInt(count));
        const needed = remaining > capacity[index + 1]! ? remaining - capacity[index + 1]! : 0n;
        const minCount = Number((needed + unit - 1n) / unit);

        for (let taken = maxCount; taken >= minCount; taken--) {
            const rest = search(index + 1, remaining - unit * BigInt(taken));

            if (rest) return [taken, ...rest];
        }

        failed[index]!.add(remaining);

        return undefined;
    };

    const counts = search(0, amount);

    if (!counts) return undefined;

    // Map back to the caller's unit order.
    return spendable.units.map((unit) => {
        const index = units.indexOf(unit);

        return index === -1 ? 0 : counts[index]!;
    });
}

/** Whether `amount` can be unshielded in one operation. */
export function isSpendable(spendable: Spendable, amount: bigint): boolean {
    if (amount <= 0n) return false;

    if (spendable.kind === 'continuous') return amount <= spendable.max;

    return solveSpendable(spendable, amount) !== undefined;
}

/** The largest reachable sum not above `target`, 0 included. */
function largestReachable(units: SpendableUnit[], target: bigint): bigint {
    const { capacity } = suffixes(units);
    const memo = new Map<string, bigint>();

    const best = (index: number, remaining: bigint): bigint => {
        if (index === units.length || remaining <= 0n) return 0n;

        if (capacity[index]! <= remaining) return capacity[index]!;

        const key = `${index}:${remaining}`;
        const cached = memo.get(key);

        if (cached !== undefined) return cached;

        const { amount, count } = units[index]!;
        const maxCount = remaining / amount < BigInt(count) ? remaining / amount : BigInt(count);
        let result = 0n;

        for (let taken = maxCount; taken >= 0n; taken--) {
            const taking = amount * taken;

            // Fewer notes of this unit can't beat what is already found.
            if (taking + capacity[index + 1]! <= result) break;

            const sum = taking + best(index + 1, remaining - taking);

            if (sum > result) result = sum;

            if (result === remaining) break;
        }

        memo.set(key, result);

        return result;
    };

    return best(0, target);
}

/**
 * The nearest amounts to `amount` that can be unshielded in one operation.
 * Both equal `amount` when it is spendable.
 */
export function nearestSpendable(spendable: Spendable, amount: bigint): NearestSpendable {
    const total = spendableTotal(spendable);
    const target = amount < 0n ? 0n : amount;

    if (spendable.kind === 'continuous') {
        const below = target < total ? target : total;

        return {
            below: below > 0n ? below : undefined,
            above: target > 0n && target <= total ? target : undefined,
        };
    }

    const units = usableUnits(spendable.units);
    const below = largestReachable(units, target);
    // Sum S is reachable iff total - S is: spend the complement of the notes.
    const above = target > total ? undefined : total - largestReachable(units, total - target);

    return {
        below: below > 0n ? below : undefined,
        above: above !== undefined && above > 0n ? above : target === 0n ? smallestUnit(units) : undefined,
    };
}

const smallestUnit = (units: SpendableUnit[]) => units.at(-1)?.amount;
