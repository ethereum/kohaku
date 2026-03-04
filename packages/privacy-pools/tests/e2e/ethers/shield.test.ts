import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ethers } from '@kohaku-eth/provider/ethers';
import getPort from "get-port";

import { E_ADDRESS } from '../../../src/config/constants';
import { MAINNET_CONFIG } from '../../../src/config/index';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, getEnv, InitialState, unwrapBalance } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { approveERC20, assetVettingFee, deductVettingFees, getProtocolWithState, sendTxAndWait, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';

describe('PrivacyPools v1 E2E Flow', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const MAINNET_FORK_URL = getEnv('MAINNET_RPC_URL', 'https://no-fallback');
  const ENTRYPOINT_ADDRESS = BigInt(MAINNET_CONFIG.ENTRYPOINT_ADDRESS);

  // E_ADDRESS represents native ETH in Privacy Pools
  const nativeAsset = ERC20Asset(E_ADDRESS);

  const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const usdcAsset = ERC20Asset(USDC_ADDRESS);

  let vettingFeesNative: bigint;
  let vettingFeesUsdc: bigint;

  beforeAll(async () => {

    anvil = defineAnvil({
      forkUrl: MAINNET_FORK_URL,
      port: await getPort(),
      chainId: 1,
    });

    await anvil.start();

    const _protocol = getProtocolWithState();

    await _protocol.sync();
    latestState = _protocol.dumpState();

    vettingFeesNative = await assetVettingFee(await anvil.pool(1).getProvider(), ENTRYPOINT_ADDRESS, nativeAsset);
    vettingFeesUsdc = await assetVettingFee(await anvil.pool(1).getProvider(), ENTRYPOINT_ADDRESS, usdcAsset);

  }, 300_000);

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareShield] generates valid native ETH deposit transaction', async () => {
    const protocol = getProtocolWithState({ initialState: latestState });


    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: 1000000000000000000n } // 1 ETH
    );

    expect(txns).toHaveLength(1);
    const tx = txns[0];

    expect(tx.to?.toLowerCase()).toBe(MAINNET_CONFIG.ENTRYPOINT_ADDRESS.toLowerCase());
    expect(tx.value).toBe(1000000000000000000n);
    expect(tx.data).toMatch(/^0x/);
  });

  it('[prepareShield] executes successful deposit on forked mainnet', { timeout: 600_000 }, async () => {
    const pool = anvil.pool(1);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const protocol = getProtocolWithState({
      host: createMockHost(undefined, pool.rpcUrl),
      initialState: latestState
    });

    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH

    // 1. Check initial balance is 0
    const preDepositBalance = await protocol.balance([nativeAsset]);
    let { pending, approved } = unwrapBalance(preDepositBalance, nativeAsset);

    expect(pending?.amount).toBe(0n);
    expect(approved?.amount).toBe(0n);

    // 2. Prepare and execute deposit
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const [tx] = txns;
    const receipt = await sendTxAndWait(alice, tx);

    await pool.mine(1);

    expect(receipt).toBeTruthy();
    expect(receipt?.status).toBe(1); // Success

    // 3. Verify state after deposit
    const postDepositBalance = await protocol.balance([nativeAsset]);

    const DEPOSIT_AMOUNT_AFTER_EP_FEE = deductVettingFees(DEPOSIT_AMOUNT, vettingFeesNative);

    ({ pending, approved } = unwrapBalance(postDepositBalance, nativeAsset));
    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(DEPOSIT_AMOUNT_AFTER_EP_FEE);
  });

  it('[prepareShield] generates valid ERC20 deposit transaction', { timeout: 60_000 }, async () => {
    const protocol = getProtocolWithState({ initialState: latestState });


    const { txns } = await protocol.prepareShield(
      { asset: usdcAsset, amount: 100000000n } // 100 USDC
    );

    expect(txns).toHaveLength(1);
    const [tx] = txns;

    expect(tx.to?.toLowerCase()).toBe(MAINNET_CONFIG.ENTRYPOINT_ADDRESS.toLowerCase());
    expect(tx.value).toBe(0n); // ERC20 has no ETH value
    expect(tx.data).toMatch(/^0x/);
  });

  it('[prepareShield] executes successful ERC20 deposit on forked mainnet', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(2);
    const provider = ethers(await pool.getProvider());
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const protocol = getProtocolWithState({
      host: createMockHost(undefined, pool.rpcUrl),
      initialState: latestState
    });

    const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const USDC_WHALE = '0x55FE002aefF02f77364de339a1292923A15844B8'; // Circle Treasury
    const DEPOSIT_AMOUNT = 100000000n; // 100 USDC (6 decimals)

    const usdcAsset = ERC20Asset(USDC_ADDRESS);

    // 1. Check initial balance is 0
    const initialBalance = await protocol.balance([usdcAsset]);
    let { pending, approved } = unwrapBalance(initialBalance, usdcAsset);

    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(0n);

    // 2. Setup: Transfer USDC from whale to Alice
    await transferERC20FromWhale(pool.rpcUrl, USDC_ADDRESS, USDC_WHALE, alice.address, DEPOSIT_AMOUNT);

    // 3. Approve entrypoint to spend USDC
    await approveERC20(alice, USDC_ADDRESS, MAINNET_CONFIG.ENTRYPOINT_ADDRESS, DEPOSIT_AMOUNT);

    // 4. Prepare and execute deposit
    const { txns } = await protocol.prepareShield(
      { asset: usdcAsset, amount: DEPOSIT_AMOUNT }
    );

    const [tx] = txns;
    const txResponse = await alice.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gasLimit: 6000000n,
    });

    await pool.mine(1);
    const receipt = await provider.getTransactionReceipt(txResponse.hash);

    expect(receipt).toBeTruthy();
    expect(receipt?.status).toBe(1n); // Success

    // 5. Verify state after deposit
    const postDepositBalance = await protocol.balance([usdcAsset]);

    const DEPOSIT_AMOUNT_AFTER_EP_FEE = deductVettingFees(DEPOSIT_AMOUNT, vettingFeesUsdc);

    ({ pending, approved } = unwrapBalance(postDepositBalance, usdcAsset));
    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(DEPOSIT_AMOUNT_AFTER_EP_FEE);
  });

  it('[prepareShield] accumulates multiple deposits correctly', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(3);
    // const pool = anvil.raw();

    // Fund with enough ETH for multiple deposits
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const protocol = getProtocolWithState({
      host: createMockHost(undefined, pool.rpcUrl),
      initialState: latestState
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT_1 = 1000000000000000000n; // 1 ETH
    const DEPOSIT_AMOUNT_2 = 2000000000000000000n; // 2 ETH

    const POST_FEE_DEPOSIT_AMOUNT_1 = deductVettingFees(DEPOSIT_AMOUNT_1, vettingFeesNative);
    const POST_FEE_DEPOSIT_AMOUNT_2 = deductVettingFees(DEPOSIT_AMOUNT_2, vettingFeesNative);

    // 1. First deposit
    const { txns: [tx] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT_1 }
    );

    // 1.b broadcast tx
    const tx1Receipt = await sendTxAndWait(alice, tx);

    expect(tx1Receipt?.status).toEqual(1);

    // 2. Verify first deposit balance
    const balance1 = await protocol.balance([nativeAsset]);
    let { pending, approved } = unwrapBalance(balance1, nativeAsset);

    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(POST_FEE_DEPOSIT_AMOUNT_1);

    // 3. Second deposit
    const { txns: [tx2] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT_2 }
    );

    // 3.b broadcast tx
    const tx2Receipt = await sendTxAndWait(alice, tx2);

    expect(tx2Receipt?.status).toEqual(1);

    // 4. Verify cumulative balance
    const balance2 = await protocol.balance([nativeAsset]);

    ({ pending, approved } = unwrapBalance(balance2, nativeAsset));
    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(POST_FEE_DEPOSIT_AMOUNT_1 + POST_FEE_DEPOSIT_AMOUNT_2);
  });

});
