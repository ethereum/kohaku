import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Account as TongoAccount } from '@fatsolutions/tongo-evm';

import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { getEnv } from '../utils/common';
import { setupWallet, mintERC20, sendTx, createProvider, createMockHost } from '../utils/test-helpers';
import { TongoPlugin } from '../../src/tongo';
import { InsufficientBalanceError } from '@kohaku-eth/plugins';
import getPort from 'get-port';

const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://no-fallback');

const USDC_ADDRESS =
  '0xaBaAC28219739838C2428edb931b4BbB7B14bAB7';

const TONGO_CONTRACT_ADDRESS =
  '0xDf978aD176352906a5dAC3D1c025Cf4CEE9B1124';

const TONGO_DEPLOYMENT_BLOCK = 10329629;

describe('tongo EVM Transfer E2E', () => {
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

    const pool = anvil.pool(10);
    const provider = createProvider(pool.rpcUrl);
    const { ethProvider } = createMockHost(provider);
    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);

    rate = await tongoAccount.rate();
  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareTransfer] returns correctly shaped transaction', async () => {
    const pool = anvil.pool(11);
    const provider = createProvider(pool.rpcUrl);
    const { host, ethProvider } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const AMOUNT = 100_000_000n;

    const stubTx = (to: string) => ({ to, data: '0xabcdef', value: 0n });

    vi.spyOn(TongoAccount.prototype, 'state').mockResolvedValue({ balance: AMOUNT, pending: 0n, nonce: 1n });
    vi.spyOn(TongoAccount.prototype, 'transfer').mockResolvedValue({ toCalldata: () => stubTx(TONGO_CONTRACT_ADDRESS) } as any);

    const recipient = new TongoAccount(2n, TONGO_CONTRACT_ADDRESS, ethProvider).tongoAddress() as `0x${string}`;

    const { txns } = await plugin.prepareTransfer(
      { asset: tongoAssetId, amount: AMOUNT },
      recipient
    );

    vi.restoreAllMocks();

    // pending = 0, so no rollover — just transfer
    expect(txns).toHaveLength(1);

    const [transferTx] = txns;

    expect(transferTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(transferTx.value).toBe(0n);
    expect(transferTx.data).toMatch(/^0x/);
  });


  it('[prepareTransfer] executes successful transfer on forked Sepolia', async () => {
    const pool = anvil.pool(12);
    const provider = createProvider(pool.rpcUrl);
    const aliceWallet = await setupWallet(pool, process.env.TEST_PRIVATE_KEY!);
    const { host, ethProvider } = createMockHost(provider);

    const account1 = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);
    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const FUND_AMOUNT = 100_000_000n;

    // --- Fund account 1 first ---
    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, FUND_AMOUNT * rate);

    const { txns: shieldTxns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      aliceWallet.address as `0x${string}`
    );

    await sendTx(aliceWallet, shieldTxns[0]);
    await sendTx(aliceWallet, shieldTxns[1]);

    const stateAfterFund = await account1.state();

    expect(stateAfterFund.balance).toBe(FUND_AMOUNT);

    // --- Transfer to account 2 ---
    const recipient = new TongoAccount(2n, TONGO_CONTRACT_ADDRESS, ethProvider).tongoAddress() as `0x${string}`;

    const { txns } = await plugin.prepareTransfer(
      { asset: tongoAssetId, amount: FUND_AMOUNT },
      recipient,
      aliceWallet.address as `0x${string}`
    );

    await sendTx(aliceWallet, txns[0]);

    const stateAfterTransfer = await account1.state();
    expect(stateAfterTransfer.balance).toBe(0n);
  });


  it('[prepareTransfer] includes rollover when account has pending balance', async () => {
    const pool = anvil.pool(13);
    const provider = createProvider(pool.rpcUrl);
    const { host, ethProvider } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const AMOUNT = 50_000_000n;

    const stubTx = (to: string) => ({ to, data: '0xabcdef', value: 0n });

    vi.spyOn(TongoAccount.prototype, 'state').mockResolvedValue({ balance: 0n, pending: AMOUNT, nonce: 1n });
    vi.spyOn(TongoAccount.prototype, 'rollover').mockResolvedValue({ toCalldata: () => stubTx(TONGO_CONTRACT_ADDRESS) } as any);
    vi.spyOn(TongoAccount.prototype, 'transfer').mockResolvedValue({ toCalldata: () => stubTx(TONGO_CONTRACT_ADDRESS) } as any);

    const recipient = new TongoAccount(2n, TONGO_CONTRACT_ADDRESS, ethProvider).tongoAddress() as `0x${string}`;

    const { txns } = await plugin.prepareTransfer(
      { asset: tongoAssetId, amount: AMOUNT },
      recipient
    );

    vi.restoreAllMocks();

    expect(txns).toHaveLength(2);

    const [rolloverTx, transferTx] = txns;

    expect(rolloverTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(rolloverTx.value).toBe(0n);
    expect(rolloverTx.data).toMatch(/^0x/);

    expect(transferTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(transferTx.value).toBe(0n);
    expect(transferTx.data).toMatch(/^0x/);
  });


  it('[prepareTransfer] throws when there is not sufficient balance', async () => {
    const pool = anvil.pool(14);
    const provider = createProvider(pool.rpcUrl);
    const { host, ethProvider } = createMockHost(provider);

    const usdcAssetId = { __type: 'erc20' as const, contract: USDC_ADDRESS as `0x${string}` };
    const tongoAssetId = { __type: 'tongo' as const, contract: TONGO_CONTRACT_ADDRESS as `0x${string}` };
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const recipient = new TongoAccount(2n, TONGO_CONTRACT_ADDRESS, ethProvider).tongoAddress() as `0x${string}`;

    await expect(
      plugin.prepareTransfer(
        { asset: tongoAssetId, amount: 100_000_000n },
        recipient
      )
    ).rejects.toBe(InsufficientBalanceError);
  });
});
