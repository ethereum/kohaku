import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { Account as TongoAccount } from '@fatsolutions/tongo-evm';
import getPort from "get-port";



import { defineAnvil, type AnvilInstance } from '../utils/anvil';
import { getEnv } from '../utils/common';
import { setupWallet, mintERC20, sendTx, createProvider, createMockHost } from '../utils/test-helpers';
import { TongoPlugin } from '../../src/tongo';
import { Erc20Id, Eip155AccountId } from '@kohaku-eth/plugins';

const SEPOLIA_FORK_URL = getEnv('SEPOLIA_RPC_URL', 'https://no-fallback');

const USDC_ADDRESS =
  '0xaBaAC28219739838C2428edb931b4BbB7B14bAB7';

const TONGO_CONTRACT_ADDRESS =
  '0xDf978aD176352906a5dAC3D1c025Cf4CEE9B1124';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

describe('tongo EVM Fund E2E', () => {
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
    const pool = anvil.pool(1);
    const provider = createProvider(pool.rpcUrl);
    const { ethProvider } = createMockHost(provider);
    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);

    rate = await tongoAccount.rate();
  });

  it('[fund] executes successful ERC20 fund on forked Sepolia', async () => {
    const pool = anvil.pool(2);
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

    const initialState = await tongoAccount.state();

    expect(initialState.balance).toBe(0n);

    const initialTongoUsdc = await usdc.balanceOf(TONGO_CONTRACT_ADDRESS);

    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, FUND_AMOUNT * rate);

    const initialUserUsdc = await usdc.balanceOf(aliceWallet.address);

    const { txns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: FUND_AMOUNT },
      new Eip155AccountId(aliceWallet.address as `0x${string}`)
    );

    await sendTx(aliceWallet, txns[0]);
    const receipt = await sendTx(aliceWallet, txns[1]);

    expect(await usdc.balanceOf(aliceWallet.address)).toBe(initialUserUsdc - FUND_AMOUNT * rate);
    expect(await usdc.balanceOf(TONGO_CONTRACT_ADDRESS)).toBe(initialTongoUsdc + FUND_AMOUNT * rate);

    const postState = await tongoAccount.state();

    expect(postState.balance).toBe(FUND_AMOUNT);

    const fundEvent = receipt!.logs.find(
      (log) => log.address.toLowerCase() === TONGO_CONTRACT_ADDRESS.toLowerCase()
    );

    expect(fundEvent).toBeTruthy();
  });


  it('[fund] prepareShield returns correctly shaped transactions', async () => {
    const pool = anvil.pool(3);
    const provider = createProvider(pool.rpcUrl);
    const { host } = createMockHost(provider);

    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const { txns } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: 100_000_000n },
      new Eip155AccountId('0x0000000000000000000000000000000000000001')
    );

    expect(txns).toHaveLength(2);

    const [approveTx, fundTx] = txns;

    expect(approveTx.to.toLowerCase()).toBe(USDC_ADDRESS.toLowerCase());
    expect(approveTx.value).toBe(0n);
    expect(approveTx.data).toMatch(/^0x/);

    expect(fundTx.to.toLowerCase()).toBe(TONGO_CONTRACT_ADDRESS.toLowerCase());
    expect(fundTx.value).toBe(0n);
    expect(fundTx.data).toMatch(/^0x/);
  });


  it('[fund] accumulates multiple deposits correctly', async () => {
    const pool = anvil.pool(4);
    const provider = createProvider(pool.rpcUrl);
    const aliceWallet = await setupWallet(pool, process.env.TEST_PRIVATE_KEY!);
    const { host, ethProvider } = createMockHost(provider);

    const tongoAccount = new TongoAccount(1n, TONGO_CONTRACT_ADDRESS, ethProvider);
    const usdcAssetId = new Erc20Id(USDC_ADDRESS);
    const plugin = new TongoPlugin(host, {
      chain: 11155111,
      deploys: new Map([[usdcAssetId, TONGO_CONTRACT_ADDRESS]]),
    });

    const A = 100_000_000n;
    const B = 200_000_000n;

    await mintERC20(pool, USDC_ADDRESS, aliceWallet.address, (A + B) * rate);

    // --- Deposit A ---
    const { txns: txnsA } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: A },
      new Eip155AccountId(aliceWallet.address as `0x${string}`)
    );

    await sendTx(aliceWallet, txnsA[0]);
    await sendTx(aliceWallet, txnsA[1]);

    // --- Deposit B ---
    const { txns: txnsB } = await plugin.prepareShield(
      { asset: usdcAssetId, amount: B },
      new Eip155AccountId(aliceWallet.address as `0x${string}`)
    );

    await sendTx(aliceWallet, txnsB[0]);
    await sendTx(aliceWallet, txnsB[1]);

    const finalState = await tongoAccount.state();
    
    expect(finalState.balance).toBe(A + B);
  });
});
