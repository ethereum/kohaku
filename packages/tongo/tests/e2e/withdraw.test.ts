import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';
import { Account as TongoAccount } from '@fatsolutions/tongo-evm';

import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { getEnv } from '../utils/common';
import { setupWallet, mintERC20, sendTx, createProvider, createMockHost } from '../utils/test-helpers';
import { TongoPlugin } from '../../src/tongo';
import { Erc20Id, Eip155AccountId, InsufficientBalanceError } from '@kohaku-eth/plugins';
import getPort from 'get-port';

const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://no-fallback');

const USDC_ADDRESS =
  '0xaBaAC28219739838C2428edb931b4BbB7B14bAB7';

const TONGO_CONTRACT_ADDRESS =
  '0xDf978aD176352906a5dAC3D1c025Cf4CEE9B1124';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

describe('tongo EVM Unshield E2E', () => {
  let anvil: AnvilInstance;
  let rate = 0n;

  beforeAll(async () => {
    anvil = defineAnvil({
      forkUrl: SEPOLIA_FORK_URL,
      port: await getPort(),
      chainId: 11155111,
    });

    await anvil.start();
  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  beforeEach(async () => {
    const pool = anvil.pool(5);
    const provider = createProvider(pool.rpcUrl);
    const { ethProvider } = createMockHost(provider);
    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);

    rate = await tongoAccount.rate();
  });

  it('[prepareUnshield] returns correctly shaped transactions', async () => {
    const pool = anvil.pool(6);
    const provider = createProvider(pool.rpcUrl);
    const aliceWallet = await setupWallet(pool, process.env.TEST_PRIVATE_KEY!);
    const { host } = createMockHost(provider);

    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const FUND_AMOUNT = 100_000_000n;

    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, FUND_AMOUNT * rate);

    const { txns: shieldTxns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      new Eip155AccountId(aliceWallet.address as `0x${string}`)
    );

    await sendTx(aliceWallet, shieldTxns[0]);
    await sendTx(aliceWallet, shieldTxns[1]);

    const aliceAccountId = new Eip155AccountId(aliceWallet.address as `0x${string}`);
    const { txns } = await plugin.prepareUnshield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      aliceAccountId,
      aliceAccountId,
    );

    // After a normal fund, pending = 0, so no rollover — just withdraw
    expect(txns).toHaveLength(1);

    const [withdrawTx] = txns;

    expect(withdrawTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(withdrawTx.value).toBe(0n);
    expect(withdrawTx.data).toMatch(/^0x/);
  });


  it('[prepareUnshield] executes successful ERC20 unshield on forked Sepolia', async () => {
    const pool = anvil.pool(7);
    const provider = createProvider(pool.rpcUrl);
    const aliceWallet = await setupWallet(pool, process.env.TEST_PRIVATE_KEY!);
    const { host, ethProvider } = createMockHost(provider);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);
    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const FUND_AMOUNT = 100_000_000n;

    // --- Fund first ---
    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, FUND_AMOUNT * rate);

    const { txns: shieldTxns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      new Eip155AccountId(aliceWallet.address as `0x${string}`)
    );

    await sendTx(aliceWallet, shieldTxns[0]);
    await sendTx(aliceWallet, shieldTxns[1]);

    const stateAfterFund = await tongoAccount.state();

    expect(stateAfterFund.balance).toBe(FUND_AMOUNT);

    const usdcBeforeUnshield = await usdc.balanceOf(aliceWallet.address);

    // --- Unshield ---
    const aliceAccountId = new Eip155AccountId(aliceWallet.address as `0x${string}`);
    const { txns } = await plugin.prepareUnshield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      aliceAccountId,
      aliceAccountId,
    );

    const receipt = await sendTx(aliceWallet, txns[0]);

    expect(await usdc.balanceOf(aliceWallet.address)).toBe(usdcBeforeUnshield + FUND_AMOUNT * rate);

    const stateAfterUnshield = await tongoAccount.state();

    expect(stateAfterUnshield.balance).toBe(0n);

    const withdrawEvent = receipt!.logs.find(
      (log) => log.address.toLowerCase() === TONGO_CONTRACT_ADDRESS.toLowerCase()
    );

    expect(withdrawEvent).toBeTruthy();
  });


  it('[prepareUnshield] includes rollover when account has pending balance from transfer', async () => {
    const pool = anvil.pool(8);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });
    const AMOUNT = 50_000_000n;
    const RECIPIENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;

    // Simulate an account that received a transfer — pending > 0 without needing a real ZK transfer
    const stubTx = (to: string) => ({ to, data: '0xabcdef', value: 0n });

    vi.spyOn(TongoAccount.prototype, 'state').mockResolvedValue({ balance: 0n, pending: AMOUNT, nonce: 1n });
    vi.spyOn(TongoAccount.prototype, 'rollover').mockResolvedValue({ toCalldata: () => stubTx(TONGO_CONTRACT_ADDRESS) } as any);
    vi.spyOn(TongoAccount.prototype, 'withdraw').mockResolvedValue({ toCalldata: () => stubTx(TONGO_CONTRACT_ADDRESS) } as any);

    const { txns } = await plugin.prepareUnshield(
      { asset: usdcAssetId, amount: AMOUNT },
      new Eip155AccountId(RECIPIENT)
    );

    vi.restoreAllMocks();

    expect(txns).toHaveLength(2);

    const [rolloverTx, withdrawTx] = txns;

    expect(rolloverTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(rolloverTx.value).toBe(0n);
    expect(rolloverTx.data).toMatch(/^0x/);

    expect(withdrawTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(withdrawTx.value).toBe(0n);
    expect(withdrawTx.data).toMatch(/^0x/);
  });


  it('[prepareUnshield] throws when there is not sufficient balance', async () => {
    const pool = anvil.pool(9);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    await expect(
      plugin.prepareUnshield(
        { asset: usdcAssetId, amount: 100_000_000n },
        new Eip155AccountId('0x0000000000000000000000000000000000000001')
      )
    ).rejects.toBe(InsufficientBalanceError);
  });
});
