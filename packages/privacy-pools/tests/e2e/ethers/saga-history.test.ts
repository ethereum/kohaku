import { Client, HttpStore } from '@saga-sync/client';
import type { EthereumProvider } from '@kohaku-eth/provider';
import type { TransactionReceipt } from 'ethers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createSagaDataService } from '../../../src';
import { E_ADDRESS } from '../../../src/config';
import { PrivacyPoolsV1Protocol } from '../../../src/plugin/base';
import { TIMESTAMP_GRID } from '../../../src/state/thunks/syncHistoryTimestampsThunk';
import { getChainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance, type AnvilPool } from '../../utils/anvil';
import { ERC20Asset } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getProtocolWithState, sendTxAndWait, setupWallet } from '../../utils/test-helpers';

// history() over a saga-backed data service: transaction hashes come from the
// saga /v2 stream (or the RPC tail past it) and timestamps from the block grid,
// so the RPC is never asked about the account's own blocks or transactions.
// Needs SAGA_SYNC_URL pointing at a saga publication that carries
// transactionHash (the /v2 index); skipped otherwise.
const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'];
const chainId = inject('chainId');

type ProviderCall = { method: string; args: unknown[] };

// Records every provider method call, including `request` payloads.
const recordCalls = (provider: EthereumProvider, calls: ProviderCall[]): EthereumProvider =>
  new Proxy(provider, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);

      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        calls.push({ method: String(key), args });

        return value.apply(target, args);
      };
    },
  });

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString(16) : v)).toLowerCase();

// The [fromBlock, toBlock] of a log query, or undefined for other calls.
const logRange = ({ method, args }: ProviderCall): string | undefined => {
  const request = args[0] as { method?: string; params?: { fromBlock: string; toBlock: string }[] };
  const filter = method === 'getLogs'
    ? args[0] as { fromBlock: bigint; toBlock: bigint }
    : method === 'request' && request.method === 'eth_getLogs' ? request.params![0]! : undefined;

  return filter && `${BigInt(filter.fromBlock)}-${BigInt(filter.toBlock)}`;
};

const requestedBlocks = (calls: ProviderCall[]) =>
  calls.flatMap(({ method, args }) => {
    const { method: rpcMethod, params } = (args[0] ?? {}) as { method?: string; params?: unknown[] };

    if (method !== 'request' || rpcMethod !== 'eth_getBlockByNumber' || params?.[0] === 'latest') return [];

    return [BigInt(params![0] as string)];
  });

type DumpedDeposit = { blockNumber: string; transactionHash: string; pool: string };

describe.skipIf(chainId !== 1 || !SAGA_SYNC_URL)('saga-backed history', () => {
  const { entrypoint, forkBlockNumber, postman, rpcUrl } = getChainConfigSetup(1);
  const forkBlock = BigInt(forkBlockNumber);
  const nativeAsset = ERC20Asset(E_ADDRESS);

  let publishesHashes = false;
  let anvil: AnvilInstance | undefined;
  let pool: AnvilPool;
  let protocol: PrivacyPoolsV1Protocol;
  const calls: ProviderCall[] = [];

  beforeAll(async () => {
    const manifest = await new Client({ source: new HttpStore(SAGA_SYNC_URL!) }).fetchManifest();

    publishesHashes = manifest.extraLogFields('privacy-pools-1-eth')?.includes('transactionHash') ?? false;

    if (!publishesHashes) return;

    anvil = await defineAnvil({ forkUrl: rpcUrl, forkBlockNumber: Number(forkBlockNumber), chainId: 1 });
    await anvil.start();

    pool = anvil.pool(1);

    const mockHost = createMockHost({ rpcUrl: pool.rpcUrl });
    const provider = recordCalls(mockHost.provider, calls);
    // Pinned to the fork: saga serves up to the fork block, the fork's own blocks
    // come from the RPC tail.
    const dataService = await createSagaDataService({
      provider,
      chainId: 1,
      sourceUrl: SAGA_SYNC_URL!,
      headBlock: forkBlock,
    });

    ({ protocol } = await getProtocolWithState({
      entrypoint,
      host: { ...mockHost, provider },
      rpcUrl: pool.rpcUrl,
      postman,
      dataService,
    }));

    await protocol.sync();
  }, 600_000);

  afterAll(async () => {
    await anvil?.stop();
  });

  it('[sync] stores the transaction hashes saga publishes', async (ctx) => {
    if (!publishesHashes) ctx.skip();

    const [state] = Object.values(protocol.dumpState()) as unknown as [{ deposits: { depositsTuples: [string, DumpedDeposit][] } }];
    const sagaDeposits = state.deposits.depositsTuples
      .map(([, deposit]) => deposit)
      .filter(({ blockNumber }) => BigInt(blockNumber) <= forkBlock);

    expect(sagaDeposits.length).toBeGreaterThan(0);
    expect(sagaDeposits.filter(({ transactionHash }) => BigInt(transactionHash) === 0n)).toEqual([]);

    // The hash is the real one: its receipt is in that block and has a log from that pool.
    const deposit = sagaDeposits.reduce((a, b) => (BigInt(a.blockNumber) > BigInt(b.blockNumber) ? a : b));
    const hash = '0x' + BigInt(deposit.transactionHash).toString(16).padStart(64, '0');
    const receipt = await (await pool.getProvider()).getTransactionReceipt(hash);

    expect(BigInt(receipt!.blockNumber)).toBe(BigInt(deposit.blockNumber));
    expect(receipt!.logs.some(({ address }) => BigInt(address) === BigInt(deposit.pool))).toBe(true);
  });

  it('[history] reports the deposit without asking the RPC about its block or transaction', { timeout: 600_000 }, async (ctx) => {
    if (!publishesHashes) ctx.skip();

    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const { txns: [tx] } = await protocol.prepareShield({ asset: nativeAsset, amount: 1000000000000000000n });
    const { hash, blockNumber } = await sendTxAndWait(alice, tx!) as TransactionReceipt;

    // Move the head past the deposit so the head anchor is not the deposit's block.
    await pool.mine(1);
    await protocol.sync();

    calls.length = 0;

    const [event] = await protocol.history([nativeAsset]);
    const block = await (await pool.getProvider()).getBlock(blockNumber);

    expect(event).toMatchObject({
      type: 'deposit',
      transactionHash: BigInt(hash),
      blockNumber: BigInt(blockNumber),
    });
    expect(Math.abs(Number(event!.timestamp) - block!.timestamp)).toBeLessThan(3600);

    // history() syncs first: the entrypoint and every pool are scanned over one
    // shared range, the same for any account. No query narrows on the deposit.
    const logRanges = new Set(calls.flatMap((call) => logRange(call) ?? []));

    expect(logRanges.size).toBeLessThanOrEqual(1);
    expect(logRanges).not.toContain(`${blockNumber}-${blockNumber}`);

    // Headers: the grid and the synced head, nothing else.
    const offGrid = requestedBlocks(calls).filter((b) => b % TIMESTAMP_GRID !== 0n);

    expect(offGrid.length).toBeLessThanOrEqual(1);
    expect(offGrid).not.toContain(BigInt(blockNumber));
    expect(stringify(calls)).not.toContain(hash.toLowerCase().slice(2));
  });
});
