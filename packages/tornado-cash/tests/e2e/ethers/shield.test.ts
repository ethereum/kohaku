import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS } from '../../../src/config';
import { getChainConfigSetup } from '../../constants';
import { AnvilPool, defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, loadInitialState } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getProtocolWithState, sendMultipleTxsAndWait, sendTxAndWait, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';
import { TornadoCashProtocol } from '@kohaku-eth/tornado-cash';
import { parseEther, parseUnits } from 'viem';
import type { IPool } from '../../../src/data/interfaces/events.interface';
import type { Serializable } from '../../../src/state/interfaces/utils.interface';

describe('TornadoCash Deposit E2E Flow', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let poolIndex = 0;
  let protocol: TornadoCashProtocol;
  let protocolPools: Serializable<IPool>[];
  let eth1Pool: Serializable<IPool>;
  let usdc100Pool: Serializable<IPool>;
  
  const chainId: 1 | 11155111 = inject('chainId');
  const {
    forkBlockNumber,
    erc20Address,
    erc20WhaleAddress,
    rpcUrl,
  } = getChainConfigSetup(chainId);

  const initialStatePayload = loadInitialState(chainId);
  
  // E_ADDRESS represents native ETH in Privacy Pools
  const nativeAsset = ERC20Asset(E_ADDRESS);

  beforeAll(async () => {
    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber: Number(forkBlockNumber),
      chainId,
    });

    await anvil.start();
  }, 300_000);

  beforeEach(async () => {
    pool = anvil.pool(++poolIndex);
    ({ protocol } = await getProtocolWithState({
      chainId,
      initialState: () => initialStatePayload,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      rpcUrl: pool.rpcUrl,
    }));

    await protocol.sync();
    const state = await protocol.dumpState();

    protocolPools = Object.values(state)[0].pools.poolsTuples.map(([_, pool]) => pool);

    eth1Pool = protocolPools.find((p) => p.asset === '0x0' && BigInt(p.denomination) === parseEther('1'))!;
    usdc100Pool = protocolPools.find((p) => BigInt(p.asset) === BigInt(erc20Address) && BigInt(p.denomination) === parseUnits('100', 6))!;
  });

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareShield] generates valid native ETH deposit transaction', async () => {
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: parseEther('1') },
    );

    expect(txns).toHaveLength(1);
    const tx = txns[0];

    expect(tx.to?.toLowerCase()).toBe(eth1Pool.address);
    expect(tx.value).toBe(parseEther('1'));
    expect(tx.data).toMatch(/^0x/);
  });

  it('[prepareShield] executes successful deposit on forked mainnet', { timeout: 600_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH

    // 1. Check initial balance is 0
    const [{ amount }] = await protocol.balance([nativeAsset]);

    expect(amount).toBe(0n);

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
    const [{ amount: postDepositBalance}] = await protocol.balance([nativeAsset]);

    expect(postDepositBalance).toBe(DEPOSIT_AMOUNT);
  });

  it('[prepareShield] executes successful ERC20 deposit on forked mainnet', { timeout: 60_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const DEPOSIT_AMOUNT = BigInt(usdc100Pool.denomination); // 100 USDC (6 decimals)

    const erc20Asset = ERC20Asset(erc20Address);

    // 1. Check initial balance is 0
    const [{amount: initialBalance}] = await protocol.balance([erc20Asset]);

    expect(initialBalance).toBe(0n);

    // 2. Setup: Transfer ERC20 from whale to Alice
    await transferERC20FromWhale(pool.rpcUrl, erc20Address, erc20WhaleAddress, alice.address, DEPOSIT_AMOUNT);

    // 3. Prepare and execute deposit
    const { txns } = await protocol.prepareShield(
      { asset: erc20Asset, amount: DEPOSIT_AMOUNT }
    );

    const receipts = await sendMultipleTxsAndWait(alice, txns);

    // const receipts = await Promise.all(txns.map((tx) => sendTxAndWait(alice, tx)));

    for (const receipt of receipts) {
      expect(receipt).toBeTruthy();
      expect(receipt?.status).toBe(1);
    }

    // 5. Verify state after deposit
    const [{amount: postDepositBalance}] = await protocol.balance([erc20Asset]);

    expect(postDepositBalance).toBe(DEPOSIT_AMOUNT);
  });

  it('[prepareShield] accumulates multiple deposits correctly', async () => {
    // Fund with enough ETH for multiple deposits
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT_1 = parseEther('1'); // 1 ETH
    const DEPOSIT_AMOUNT_2 = parseEther('2'); // 2 ETH

    // 1. First deposit
    const { txns: [tx] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT_1 }
    );

    // 1.b broadcast tx
    const tx1Receipt = await sendTxAndWait(alice, tx);

    expect(tx1Receipt?.status).toEqual(1);

    // 2. Verify first deposit balance
    const [{ amount: balance1 }] = await protocol.balance([nativeAsset]);

    expect(balance1).toBe(DEPOSIT_AMOUNT_1);

    // 3. Second deposit
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT_2 }
    );

    // 3.b broadcast tx
    const receipts2 = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of receipts2) {
      expect(receipt).toBeTruthy();
      expect(receipt?.status).toBe(1);
    }

    // 4. Verify cumulative balance
    const [{ amount: balance2}] = await protocol.balance([nativeAsset]);

    expect(balance2).toBe(DEPOSIT_AMOUNT_1 + DEPOSIT_AMOUNT_2);
  });

});
