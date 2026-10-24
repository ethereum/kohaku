import type { EthereumProvider, TxLog } from '@kohaku-eth/provider';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';
import { POOL_EVENTS_SIGNATURES } from '../../src/data/abis/events.abi';
import { DataService } from '../../src/data/data.service';
import type { Address } from '../../src/interfaces/types.interface';

const POOL = '0x0000000000000000000000000000000000001000';
const TX = `0x${'ab'.repeat(32)}`;

const depositLog = (extra: Partial<TxLog>): TxLog => ({
  address: POOL,
  blockNumber: 150n,
  topics: encodeEventTopics({
    abi: [POOL_EVENTS_SIGNATURES.PoolDeposited],
    args: { _depositor: '0x0000000000000000000000000000000000003000' },
  }) as string[],
  data: encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [11n, 10n, 100n, 1n],
  ),
  ...extra,
});

const poolDeposits = (log: TxLog) =>
  new DataService({ provider: {} as EthereumProvider, getLogs: async () => [log] })
    .getPoolEvents({ events: ['PoolDeposited'], address: BigInt(POOL) as Address, fromBlock: 100n, toBlock: 200n })
    .then(({ PoolDeposited }) => PoolDeposited);

describe('DataService logs', () => {
  it('keeps the transaction hash and log index the log source provides', async () => {
    expect(await poolDeposits(depositLog({ logIndex: 7, transactionHash: TX }))).toEqual([
      expect.objectContaining({ precommitment: 1n, blockNumber: 150n, logIndex: 7, transactionHash: BigInt(TX) }),
    ]);
  });

  it('leaves the hash 0 for a source without one (saga)', async () => {
    expect(await poolDeposits(depositLog({ logIndex: 7 }))).toEqual([
      expect.objectContaining({ precommitment: 1n, transactionHash: 0n }),
    ]);
  });
});
