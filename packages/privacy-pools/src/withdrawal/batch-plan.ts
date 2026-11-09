import type { Address } from '../interfaces/types.interface';
import type { INote } from '../plugin/interfaces/protocol-params.interface';

export interface PPv1BatchWithdrawalPlan {
  /** Gross amount, before paymaster fees. Always equals the requested amount. */
  amount: bigint;
  notes: { note: INote; withdrawnValue: bigint; changeValue: bigint }[];
  fullySpentNoteCount: number;
  /** Maximum gross across all eligible notes while leaving at least 1% on each. */
  maxObfuscatedAmount: bigint;
  /** Suggested gross (at most the request) leaving at least 5% on selected notes. */
  suggestedAmount?: bigint;
}

export class PPv1AmountObfuscationError extends Error {
  constructor(
    readonly requestedAmount: bigint,
    readonly maxObfuscatedAmount: bigint,
    readonly suggestedAmount: bigint,
  ) {
    super(`Cannot obfuscate batch amount ${requestedAmount}: maximum is ${maxObfuscatedAmount}; try ${suggestedAmount} or disable obfuscateAmounts`);
    this.name = 'PPv1AmountObfuscationError';
  }
}

const min = (a: bigint, b: bigint) => a < b ? a : b;
const changeFor = (balance: bigint, percent: bigint) => (balance * percent + 99n) / 100n;

/** Unbiased, cryptographically random integer in [0, maximum], including large token amounts. */
function randomUpTo(maximum: bigint): bigint {
  if (maximum === 0n) return 0n;

  const bits = maximum.toString(2).length;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  const mask = 255 >>> (bytes.length * 8 - bits);

  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    bytes[0] = bytes[0]! & mask;
    const value = BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`);

    if (value <= maximum) return value;
  }
}

/**
 * Purely local planning; no proofs, signatures, or network requests. Input notes
 * must belong to the same account/chain snapshot. Unapproved/spent/other-asset
 * notes are ignored. Randomness is sampled anew on every obfuscated plan.
 */
export function planPPv1BatchWithdrawal(
  notes: readonly INote[],
  asset: Address,
  amount: bigint,
  { obfuscateAmounts = false }: { obfuscateAmounts?: boolean } = {},
): PPv1BatchWithdrawalPlan {
  if (amount <= 0n) throw new Error('Withdrawal amount must be greater than zero');

  const eligible = notes.filter(note => note.assetAddress === asset && note.approved && note.balance > 0n)
    .sort((a, b) => a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0);
  const total = eligible.reduce((sum, note) => sum + note.balance, 0n);

  if (amount > total) throw new Error(`Insufficient approved balance: remaining ${amount - total} to spend`);

  const maxObfuscatedAmount = eligible.reduce((sum, note) => sum + note.balance - changeFor(note.balance, 1n), 0n);
  let remaining = amount;
  let selected = eligible.filter(note => {
    if (remaining <= 0n) return false;

    remaining -= note.balance;

    return true;
  });
  const obfuscate = obfuscateAmounts && selected.length > 1;

  if (obfuscate) {
    if (amount > maxObfuscatedAmount) {
      const suggested = eligible.reduce((sum, note) => sum + note.balance - changeFor(note.balance, 5n), 0n);

      throw new PPv1AmountObfuscationError(amount, maxObfuscatedAmount, suggested);
    }

    // Include an extra note when the original minimal set has too little headroom.
    remaining = amount;
    selected = eligible.filter(note => {
      const capacity = note.balance - changeFor(note.balance, 1n);

      if (remaining <= 0n || capacity === 0n) return false;

      remaining -= capacity;

      return true;
    });
  }

  // Random reserves are independent when there is room for 5% on every note.
  // Near the maximum, constrain each draw to preserve enough room for the total.
  let extraChange = selected.reduce((sum, note) => sum + note.balance - changeFor(note.balance, 1n), 0n) - amount;

  remaining = amount;
  const planned = selected.map(note => {
    let reserve = 0n;

    if (obfuscate) {
      const minimum = changeFor(note.balance, 1n);
      const maximum = min(changeFor(note.balance, 5n), note.balance - 1n);
      const extra = randomUpTo(min(maximum - minimum, extraChange));

      reserve = minimum + extra;
      extraChange -= extra;
    }

    const withdrawnValue = min(note.balance - reserve, remaining);

    remaining -= withdrawnValue;

    return { note, withdrawnValue, changeValue: note.balance - withdrawnValue };
  });
  const fullySpentNoteCount = planned.filter(note => note.changeValue === 0n).length;
  const suggestedAmount = planned.length > 1 && fullySpentNoteCount > 0
    ? min(amount, selected.reduce((sum, note) => sum + note.balance - changeFor(note.balance, 5n), 0n))
    : undefined;

  return { amount, notes: planned, fullySpentNoteCount, maxObfuscatedAmount, suggestedAmount };
}
