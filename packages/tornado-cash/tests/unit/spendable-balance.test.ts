import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientBalanceError, UnreachableAmountError, type Host } from '@kohaku-eth/plugins';

import { E_ADDRESS, TornadoCashConfigs } from '../../src/config';
import { IIndexedDepositWithSecrets, IPool } from '../../src/data/interfaces/events.interface';
import { Address } from '../../src/interfaces/types.interface';
import { TornadoCashProtocol } from '../../src/plugin/base';
import { spendableUnitsSelector } from '../../src/state/selectors/withdrawals.selector';

const ETH = 10n ** 18n;
const DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0Fn as Address;

const { remote } = vi.hoisted(() => ({ remote: {
  init: vi.fn(async () => {}), sync: vi.fn(async () => {}),
  getBalances: vi.fn(async (): Promise<Map<bigint, bigint>> => new Map()),
  getSpendableUnits: vi.fn(async (): Promise<Map<bigint, { amount: bigint; count: number }[]>> => new Map()),
  getWithdrawalPayloads: vi.fn(async (): Promise<unknown[]> => []),
} }));

vi.mock('#worker-loader', () => ({ loadStateManagerWorker: () => ({ remote, onError: () => {} }) }));

const host = { provider: {}, keystore: {}, storage: {}, network: { fetch } } as unknown as Host;
const ethAsset = { contract: E_ADDRESS, __type: 'erc20' as const };

const pool = (address: bigint, asset: Address, denomination: bigint) =>
  ({ address, asset, denomination } as IPool);
const notes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ commitment: BigInt(index) } as IIndexedDepositWithSecrets));

describe('spendableUnitsSelector', () => {
  it('groups unspent notes per asset from the largest denomination, leaving out empty pools', () => {
    const pools = [pool(1n, 0n as Address, ETH / 10n), pool(2n, 0n as Address, ETH), pool(3n, 0n as Address, 10n * ETH), pool(4n, DAI, 100n * ETH)];
    const unspent = new Map([[1n, notes(10)], [2n, notes(1)], [3n, []], [4n, notes(2)]]) as Map<Address, IIndexedDepositWithSecrets[]>;

    const units = spendableUnitsSelector.resultFunc(unspent, new Map(pools.map((p) => [p.address, p])) as Map<Address, IPool>);

    expect(units).toEqual(new Map([
      [0n, [{ amount: ETH, count: 1 }, { amount: ETH / 10n, count: 10 }]],
      [DAI, [{ amount: 100n * ETH, count: 2 }]],
    ]));
  });
});

describe('TornadoCashProtocol spendable balance', () => {
  beforeEach(() => {
    remote.getBalances.mockResolvedValue(new Map([[0n, 2n * ETH]]));
    remote.getSpendableUnits.mockResolvedValue(new Map([[0n, [{ amount: ETH, count: 1 }, { amount: ETH / 10n, count: 10 }]]]));
    remote.getWithdrawalPayloads.mockClear();
  });

  it('returns the denomination units next to the total', async () => {
    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });

    expect(await protocol.balance([ethAsset])).toEqual([{
      asset: ethAsset,
      amount: 2n * ETH,
      spendable: { kind: 'discrete', units: [{ amount: ETH, count: 1 }, { amount: ETH / 10n, count: 10 }] },
    }]);
  });

  it('rejects an amount no notes add up to with the nearest ones, before preparing anything', async () => {
    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });
    const error = await protocol.prepareUnshield({ asset: ethAsset, amount: ETH / 4n }, '0x0000000000000000000000000000000000000003')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnreachableAmountError);
    expect(error).toMatchObject({ requested: ETH / 4n, below: ETH / 5n, above: ETH * 3n / 10n });
    expect(remote.getWithdrawalPayloads).not.toHaveBeenCalled();
  });

  it('rejects an amount over the total as insufficient', async () => {
    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });

    await expect(protocol.prepareUnshield({ asset: ethAsset, amount: 3n * ETH }, '0x0000000000000000000000000000000000000003'))
      .rejects.toThrow(InsufficientBalanceError);
    expect(remote.getWithdrawalPayloads).not.toHaveBeenCalled();
  });

  it('prepares a reachable amount', async () => {
    const protocol = new TornadoCashProtocol(host, { protocolConfig: TornadoCashConfigs[1] });

    await protocol.prepareUnshield({ asset: ethAsset, amount: ETH * 13n / 10n }, '0x0000000000000000000000000000000000000003');

    expect(remote.getWithdrawalPayloads).toHaveBeenCalledWith(expect.objectContaining({ asset: 0n, amount: ETH * 13n / 10n }));
  });
});
