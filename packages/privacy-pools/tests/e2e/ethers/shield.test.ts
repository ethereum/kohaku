import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';


import { E_ADDRESS } from '../../../src/config';
import { addressToHex } from '../../../src/utils';
import { chainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';
import { createMockAspService } from '../../utils/mock-asp-service';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { approveERC20, assetVettingFee, deductVettingFees, getProtocolWithState, sendTxAndWait, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';

describe('PrivacyPools v1 E2E Flow', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const mockAspService = createMockAspService();

  mockAspService.addLabels([0n, 1n, 2n]);

  const chainId = 11155111;
  const {
    entrypoint,
    forkBlockNumber,
    erc20Address,
    erc20WhaleAddress,
    rpcUrl
  } = chainConfigSetup[chainId];

  const ENTRYPOINT_ADDRESS = entrypoint.address;
  const ENTRYPOINT_ADDRESS_HEX = addressToHex(ENTRYPOINT_ADDRESS);

  // E_ADDRESS represents native ETH in Privacy Pools
  const nativeAsset = ERC20Asset(E_ADDRESS);

  const erc20Asset = ERC20Asset(erc20Address);

  let vettingFeesNative: bigint;
  let vettingFeesErc20: bigint;

  beforeAll(async () => {

    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber: Number(forkBlockNumber),
      chainId,
    });

    await anvil.start();

    const pool = anvil.pool(1);
    const { protocol: _protocol } = getProtocolWithState({
      entrypoint,
      initialState: await loadInitialState(),
      host: createMockHost({ rpcUrl: pool.rpcUrl })
    });

    await _protocol.sync();
    latestState = _protocol.dumpState();

    const provider = await pool.getProvider();

    vettingFeesNative = await assetVettingFee({ provider, entrypointAddress: ENTRYPOINT_ADDRESS, asset: nativeAsset });
    vettingFeesErc20 = await assetVettingFee({ provider, entrypointAddress: ENTRYPOINT_ADDRESS, asset: erc20Asset });

  }, 300_000);

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareShield] generates valid native ETH deposit transaction', async () => {

    const pool = anvil.pool(2);
    const { protocol } = getProtocolWithState({
      entrypoint,
      initialState: latestState,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
    });

    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: 1000000000000000000n } // 1 ETH
    );

    expect(txns).toHaveLength(1);
    const tx = txns[0];

    expect(tx.to?.toLowerCase()).toBe(ENTRYPOINT_ADDRESS_HEX.toLowerCase());
    expect(tx.value).toBe(1000000000000000000n);
    expect(tx.data).toMatch(/^0x/);
  });

  it('[prepareShield] executes successful deposit on forked mainnet', { timeout: 600_000 }, async () => {
    const pool = anvil.pool(3);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const { protocol } = getProtocolWithState({
      entrypoint,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
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
    const pool = anvil.pool(4);
    const { protocol } = getProtocolWithState({
      entrypoint,
      initialState: latestState,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
    });


    const { txns } = await protocol.prepareShield(
      { asset: erc20Asset, amount: 100000000n } // 100 USDC
    );

    expect(txns).toHaveLength(1);
    const [tx] = txns;

    expect(tx.to?.toLowerCase()).toBe(ENTRYPOINT_ADDRESS_HEX.toLowerCase());
    expect(tx.value).toBe(0n); // ERC20 has no ETH value
    expect(tx.data).toMatch(/^0x/);
  });

  it('[prepareShield] executes successful ERC20 deposit on forked mainnet', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(5);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const { protocol } = getProtocolWithState({
      entrypoint,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      initialState: latestState
    });

    const DEPOSIT_AMOUNT = 100000000n; // 100 USDC (6 decimals)

    const erc20Asset = ERC20Asset(erc20Address);

    // 1. Check initial balance is 0
    const initialBalance = await protocol.balance([erc20Asset]);
    let { pending, approved } = unwrapBalance(initialBalance, erc20Asset);

    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(0n);

    // 2. Setup: Transfer ERC20 from whale to Alice
    await transferERC20FromWhale(pool.rpcUrl, erc20Address, erc20WhaleAddress, alice.address, DEPOSIT_AMOUNT);

    // 3. Approve entrypoint to spend ERC20
    const appReceipt = await approveERC20(alice, erc20Address, ENTRYPOINT_ADDRESS_HEX, DEPOSIT_AMOUNT);

    expect(appReceipt).toBeTruthy();
    expect(appReceipt?.status).toBe(1); // Success

    // 4. Prepare and execute deposit
    const { txns } = await protocol.prepareShield(
      { asset: erc20Asset, amount: DEPOSIT_AMOUNT }
    );

    const [tx] = txns;
    const receipt = await sendTxAndWait(alice, tx);

    expect(receipt).toBeTruthy();
    expect(receipt?.status).toBe(1); // Success

    // 5. Verify state after deposit
    const postDepositBalance = await protocol.balance([erc20Asset]);

    const DEPOSIT_AMOUNT_AFTER_EP_FEE = deductVettingFees(DEPOSIT_AMOUNT, vettingFeesErc20);

    ({ pending, approved } = unwrapBalance(postDepositBalance, erc20Asset));
    expect(approved?.amount).toBe(0n);
    expect(pending?.amount).toBe(DEPOSIT_AMOUNT_AFTER_EP_FEE);
  });

  it('[prepareShield] accumulates multiple deposits correctly', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(6);

    // Fund with enough ETH for multiple deposits
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create host with pool-specific RPC URL
    const { protocol } = getProtocolWithState({
      entrypoint,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
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
