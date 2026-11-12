import { describe, expect, it, vi } from 'vitest';
import type { IDepositWithBalance } from '../../src/data/interfaces/events.interface';
import { getNoteSelector } from '../../src/state/selectors/notes.selector';
import type { RootState } from '../../src/state/store';

const fixture = vi.hoisted(() => ({ deposits: new Map<bigint, IDepositWithBalance>(), withdrawals: new Map() }));

vi.mock('../../src/state/selectors/balance.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/balance.selector')>(),
  myDepositsBalanceSelector: () => fixture.deposits,
}));
vi.mock('../../src/state/selectors/withdrawals.selector', async original => ({
  ...await original<typeof import('../../src/state/selectors/withdrawals.selector')>(),
  myWithdrawalsSelector: () => fixture.withdrawals,
}));

const ASSET = 0xaan;

const deposit = (label: bigint, balance: bigint, approved = true) => ({
  label, precommitment: label, commitment: label, index: Number(label), value: balance, balance,
  assetAddress: ASSET, approved, depositor: 5n, blockNumber: 1n,
}) as unknown as IDepositWithBalance;

const select = (deposits: IDepositWithBalance[], minAmount: bigint) => {
  fixture.deposits = new Map(deposits.map(entry => [entry.precommitment, entry]));

  return getNoteSelector({} as RootState, ASSET, minAmount);
};

describe('getNoteSelector', () => {
  it('skips a smaller unapproved note for the smallest approved one', () => {
    expect(select([deposit(1n, 500n, false), deposit(2n, 900n), deposit(3n, 1000n)], 400n)?.label).toBe(2n);
  });

  it('never returns an empty note, even for a zero minimum', () => {
    expect(select([deposit(1n, 0n), deposit(2n, 300n)], 0n)?.label).toBe(2n);
    expect(select([deposit(1n, 0n), deposit(2n, 300n, false)], 0n)).toBeUndefined();
  });
});
