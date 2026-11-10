import type { Address } from '../interfaces/types.interface';
import type { INote } from '../plugin/interfaces/protocol-params.interface';
import type { NoteToSpend } from '../state/selectors/notes.selector';

export class PPv1AmountObfuscationError extends Error {
  constructor(
    readonly requestedAmount: bigint,
    readonly maxObfuscatedAmount: bigint,
  ) {
    super(`Protected withdrawal amount ${requestedAmount} exceeds maximum gross ${maxObfuscatedAmount}`);
    this.name = 'PPv1AmountObfuscationError';
  }
}

const min = (a: bigint, b: bigint) => a < b ? a : b;
const max = (a: bigint, b: bigint) => a > b ? a : b;
const changeFor = (balance: bigint, bps: bigint) => (balance * bps + 9_999n) / 10_000n;

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

/** Internal batch allocation. Reserves round up to asset base units. */
export function planObfuscatedBatchWithdrawal(
  notes: readonly INote[],
  asset: Address,
  amount: bigint,
): NoteToSpend[] {
  if (amount <= 0n) throw new Error('Withdrawal amount must be greater than zero');

  const eligible = notes.filter(note => note.assetAddress === asset && note.approved && note.balance > 0n)
    .sort((a, b) => a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0);
  const total = eligible.reduce((sum, note) => sum + note.balance, 0n);
  let available = eligible.reduce((sum, note) => sum + note.balance - changeFor(note.balance, 100n), 0n);
  const maxObfuscatedAmount = min(total * 97n / 100n, available);

  if (amount > maxObfuscatedAmount) {
    throw new PPv1AmountObfuscationError(amount, maxObfuscatedAmount);
  }

  let remaining = amount;
  const selected: NoteToSpend[] = [];

  for (const note of eligible) {
    if (remaining <= 0n) break;

    const capacity = note.balance - changeFor(note.balance, 100n);

    available -= capacity;

    if (capacity === 0n) continue;

    // Finish with a partial note, or randomize a 75–99% spend. The lower bound
    // ensures the unspent notes can always supply the rest of the exact request.
    const lower = max(note.balance - changeFor(note.balance, 2_500n), remaining - available);
    const withdrawnValue = remaining <= capacity ? remaining : lower + randomUpTo(capacity - lower);

    selected.push({ note, withdrawnValue });
    remaining -= withdrawnValue;
  }

  return selected;
}
