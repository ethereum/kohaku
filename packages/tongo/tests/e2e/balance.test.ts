import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Account as TongoAccount } from '@fatsolutions/tongo-evm';
import getPort from "get-port";

import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { getEnv } from '../utils/common';
import { setupWallet, mintERC20, sendTx, createProvider, createMockHost } from '../utils/test-helpers';
import { TongoPlugin } from '../../src/tongo';

const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://no-fallback');

const USDC_ADDRESS =
  '0xaBaAC28219739838C2428edb931b4BbB7B14bAB7';

const TONGO_CONTRACT_ADDRESS =
  '0xDf978aD176352906a5dAC3D1c025Cf4CEE9B1124';

const TONGO_DEPLOYMENT_BLOCK = 10329629;

describe('tongo EVM Balance E2E', () => {
  let anvil: AnvilInstance;
  let rate = 0n;

  beforeAll(async () => {
    anvil = defineAnvil({
      forkUrl: SEPOLIA_FORK_URL,
      forkBlockNumber: TONGO_DEPLOYMENT_BLOCK,
      port: await getPort(),
      chainId: 11155111,
    });

    await anvil.start();

    const pool = anvil.pool(15);
    const provider = createProvider(pool.rpcUrl);
    const { ethProvider } = createMockHost(provider);
    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);

    rate = await tongoAccount.rate();
  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  it('[balance] returns zero for a fresh account', async () => {
    const pool = anvil.pool(16);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const result = await plugin.balance([tongoAssetId]);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toEqual(tongoAssetId);
    expect(result[0]!.amount).toBe(0n);
    expect(result[1]!.amount).toBe(0n);
    expect(result[1]!.tag).toBe('pending');
  });

  it('[balance] returns correct balance after shielding', async () => {
    const pool = anvil.pool(17);
    const provider = createProvider(pool.rpcUrl);
    const aliceWallet = await setupWallet(pool, process.env.TEST_PRIVATE_KEY!);
    const { host } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const FUND_AMOUNT = 100_000_000n;

    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, FUND_AMOUNT * rate);

    const { txns: shieldTxns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      aliceWallet.address as `0x${string}`
    );

    await sendTx(aliceWallet, shieldTxns[0]);
    await sendTx(aliceWallet, shieldTxns[1]);

    const result = await plugin.balance([tongoAssetId]);

    expect(result).toHaveLength(2);
    const balanceEntry = result.find(r => !r.tag);
    expect(balanceEntry!.amount).toBe(FUND_AMOUNT);
  });

  it('[balance] returns balance and pending as separate entries', async () => {
    const pool = anvil.pool(18);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const BALANCE = 60_000_000n;
    const PENDING = 40_000_000n;

    vi.spyOn(TongoAccount.prototype, 'state').mockResolvedValue({ balance: BALANCE, pending: PENDING, nonce: 1n });

    const result = await plugin.balance([tongoAssetId]);

    vi.restoreAllMocks();

    expect(result).toHaveLength(2);
    const balanceEntry = result.find(r => !r.tag);
    const pendingEntry = result.find(r => r.tag === 'pending');
    expect(balanceEntry!.amount).toBe(BALANCE);
    expect(pendingEntry!.amount).toBe(PENDING);
  });

  it('[balance] returns empty array for unconfigured asset', async () => {
    const pool = anvil.pool(19);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map(),
    });

    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const result = await plugin.balance([tongoAssetId]);

    expect(result).toHaveLength(0);
  });

  it('[balance] returns all configured assets when called with undefined', async () => {
    const pool = anvil.pool(20);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const BALANCE = 75_000_000n;
    const PENDING = 25_000_000n;

    vi.spyOn(TongoAccount.prototype, 'state').mockResolvedValue({ balance: BALANCE, pending: PENDING, nonce: 1n });

    const result = await plugin.balance(undefined);

    vi.restoreAllMocks();

    expect(result).toHaveLength(2);
    const balanceEntry = result.find(r => !r.tag);
    const pendingEntry = result.find(r => r.tag === 'pending');
    expect(balanceEntry!.amount).toBe(BALANCE);
    expect(pendingEntry!.amount).toBe(PENDING);
  });
});
