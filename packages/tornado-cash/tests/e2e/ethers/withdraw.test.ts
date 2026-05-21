import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';

import { E_ADDRESS } from '../../../src/config';
import { AnvilPool, defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, loadInitialState } from '../../utils/common';

import { createMockHost } from '../../utils/mock-host';
import { createMockRelayerClient } from '../../utils/mock-relayer';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getERC20Balance, getProtocolWithState, sendMultipleTxsAndWait, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';
import { getChainConfigSetup } from '../../constants';
import { parseEther } from 'viem';
import { TCBroadcaster, TornadoCashProtocol } from '@kohaku-eth/tornado-cash';
import { Wallet } from 'ethers';
import type { IPool } from '../../../src/data/interfaces/events.interface';
import type { Serializable } from '../../../src/state/interfaces/utils.interface';

describe('TornadoCash Unshield E2E', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let poolIndex = 0;
  let protocol: TornadoCashProtocol;
  let broadcaster: TCBroadcaster;
  let relayerClient: ReturnType<typeof createMockRelayerClient>;
  let relayerWallet: Wallet;
  let erc20Pool: Serializable<IPool>;

  const chainId = inject('chainId');
  const {
    forkBlockNumber,
    rpcUrl,
    erc20Address,
    erc20WhaleAddress,
  } = getChainConfigSetup(chainId);


  const initialStatePayload = loadInitialState(chainId).then((s) => {
    s[Object.keys(s)[0]].relayers.relayersTuples = [
      [
          "relayer-service.eth",
          {
              "ensName": "relayer-service.eth",
              "hostname": "cheap",
              "relayerAddress": "0x20bb3095a4852f4c97d7a188e9f7183c85acfc49",
              "stakeBalance": "0x17702744fe24f771b0"
          }
      ],
      [
          "releth.eth",
          {
              "ensName": "releth.eth",
              "hostname": "expensive",
              "relayerAddress": "0x47b03df2145cc9eed6d8819e02d25590f297c603",
              "stakeBalance": "0xa13dee61e7f29d13a"
          }
      ],
    ];

    return s;
  });

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
    relayerWallet = await setupWallet(pool, TEST_ACCOUNTS.charlie.privateKey)
    relayerClient = createMockRelayerClient({ signer: relayerWallet, chainId });
    ({ protocol, broadcaster } = await getProtocolWithState({
      chainId,
      initialState: () => initialStatePayload,
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      relayerClientFactory: () => relayerClient,
      rpcUrl: pool.rpcUrl,
    }));

    await protocol.sync();

    const state = await protocol.dumpState();
    const protocolPools = Object.values(state)[0].pools.poolsTuples.map(([, p]: [unknown, Serializable<IPool>]) => p);

    erc20Pool = protocolPools.find((p) => BigInt(p.asset) === BigInt(erc20Address))!;
  });

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareUnshield] prepares withdrawal after deposit', async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH

    // 1. Deposit first
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const receipts = await sendMultipleTxsAndWait(alice, txns);

    expect(receipts.reduce((n, receipt) => n + (receipt?.status ? 1 : 0), 0)).toBe(receipts.length);

    await pool.mine(1);

    // 2. Verify deposit balance
    const [{amount}] = await protocol.balance([nativeAsset]);

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // 3. Prepare withdrawal
    const recipientAccount = alice.address as AccountId;
    const {withdrawals: [withdrawOp]} = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT },
      recipientAccount
    );

    // 4. Verify withdrawal operation structure
    expect(withdrawOp.proof).toBeDefined();
    expect(withdrawOp.relayerUrl).toBeDefined();
    expect(withdrawOp.poolAddress).toBeDefined();
  });

  it('[prepareUnshield] selects lowest fee relayer', { timeout: 60_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n;
    const WITHDRAW_AMOUNT = DEPOSIT_AMOUNT;

    // 1. Deposit
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const receipts = await sendMultipleTxsAndWait(alice, txns);

    expect(receipts.reduce((n, receipt) => n + (receipt?.status ? 1 : 0), 0)).toBe(receipts.length);

    await pool.mine(1);

    // 2. Verify deposit balance (triggers sync)
    const [{amount}] = await protocol.balance([nativeAsset]);

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // 3. Prepare withdrawal - should select cheap relayer
    const recipientAccount = alice.address as AccountId;
    const {withdrawals: [withdrawalOp]} = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    // 4. Verify cheapest relayer was selected
    expect(withdrawalOp.relayerUrl).toBe('https://cheap/');
  });

  it('[prepareUnshield] throws when no sufficient balance', { timeout: 60_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const WITHDRAW_AMOUNT = 1000000000000000000n; // 1 ETH (no deposit made)

    // Try to withdraw without depositing first
    const recipientAccount = alice.address as AccountId;

    const [{amount}] = await protocol.balance([nativeAsset]);

    expect((amount) < WITHDRAW_AMOUNT).toBeTruthy();

    await expect(
      protocol.prepareUnshield(
        { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
        recipientAccount
      )
    ).rejects.toThrow('Insufficient balance to spend. Got 0. Expected at least: 1000000000000000000');

  });

  it('[prepareUnshield] throws when all relayers fail', { timeout: 60_000 }, async () => {
    relayerClient.setAlwaysFail(true);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n;
    const WITHDRAW_AMOUNT = 1000000000000000000n / 2n;

    // 1. Deposit first
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    await alice.sendTransaction({
      to: txns[0].to,
      data: txns[0].data,
      value: txns[0].value,
      gasLimit: 6000000n,
    });
    await pool.mine(2);

    // 2. Try to withdraw - relayer should fail
    const recipientAccount = alice.address as AccountId;

    await expect(
      protocol.prepareUnshield(
        { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
        recipientAccount
      )
    ).rejects.toThrow();

  });

  it('[prepareUnshield] withdrawal succeeds', { timeout: 120_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = parseEther('1.3');
    const WITHDRAW_AMOUNT = parseEther('1.2');

    // 1. Deposit
    const { txns } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const depositReceipts = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of depositReceipts) {
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
    }

    await pool.mine(1);

    // 2. Verify deposit balance (triggers sync)
    const [{amount}] = await protocol.balance([nativeAsset]);

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // 3. Prepare withdrawal
    const recipientAccount = alice.address as AccountId;
    const unshieldOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    const preWithdrawalBalance = await pool.getBalance(alice.address);

    // 4. Withdraw
    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    // 5. Verify withdrawal succeeded and went to Alice
    const [{ amount: postWithdrawTCBalance }] = await protocol.balance([nativeAsset]);
    const postWithdrawBalance = await pool.getBalance(alice.address);

    expect(postWithdrawTCBalance).toBe(DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    expect(postWithdrawBalance).toBeGreaterThan(preWithdrawalBalance);
  });

  it('[prepareUnshield] ERC20 withdrawal succeeds', { timeout: 120_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const erc20Asset = ERC20Asset(erc20Address);
    const DEPOSIT_AMOUNT = BigInt(erc20Pool.denomination);
    const WITHDRAW_AMOUNT = DEPOSIT_AMOUNT;

    // 1. Fund Alice with ERC20 tokens
    await transferERC20FromWhale(pool.rpcUrl, erc20Address, erc20WhaleAddress, alice.address, DEPOSIT_AMOUNT);

    // 2. Deposit
    const { txns } = await protocol.prepareShield({ asset: erc20Asset, amount: DEPOSIT_AMOUNT });
    const depositReceipts = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of depositReceipts) {
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
    }

    await pool.mine(1);

    // 3. Verify deposit balance
    const [{ amount }] = await protocol.balance([erc20Asset]);

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // 4. Prepare withdrawal
    const recipientAccount = alice.address as AccountId;
    const unshieldOp = await protocol.prepareUnshield(
      { asset: erc20Asset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    // 5. Record Alice's pre-withdrawal ERC20 balance
    const preWithdrawBalance = await getERC20Balance(pool.rpcUrl, erc20Address, alice.address);

    // 6. Broadcast withdrawal
    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    // 7. Verify balances
    const [{ amount: postWithdrawTCBalance }] = await protocol.balance([erc20Asset]);
    const postWithdrawBalance = await getERC20Balance(pool.rpcUrl, erc20Address, alice.address);

    expect(postWithdrawTCBalance).toBe(DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    expect(postWithdrawBalance).toBeGreaterThan(preWithdrawBalance);
  });

});
