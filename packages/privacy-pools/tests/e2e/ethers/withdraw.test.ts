import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import getPort from "get-port";

import { E_ADDRESS } from '../../../src/config/constants';
import { MAINNET_CONFIG } from '../../../src/config/index';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, getEnv, InitialState, MAINNET_ENTRYPOINT, unwrapBalance } from '../../utils/common';
import { createMockAspService } from '../../utils/mock-asp-service';
import { createMockHost } from '../../utils/mock-host';
import { mockProverFactory } from '../../utils/mock-prover';
import { createMockRelayerClient } from '../../utils/mock-relayer';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { assetVettingFee, deductVettingFees, getProtocolWithState, pushNewAspRoot, sendTxAndWait, setupWallet } from '../../utils/test-helpers';

const POSTMAN_ADDRESS_HEX = "0x1f4Fe25Cf802a0605229e0Dc497aAf653E86E187";


describe('PrivacyPools v1 Unshield E2E', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const MAINNET_FORK_URL = getEnv('MAINNET_RPC_URL', 'https://no-fallback');
  const ENTRYPOINT_ADDRESS = BigInt(MAINNET_CONFIG.ENTRYPOINT_ADDRESS);
  const POSTMAN_ADDRESS = BigInt(POSTMAN_ADDRESS_HEX);

  const nativeAsset = ERC20Asset(E_ADDRESS);
  let vettingFees = 0n;

  beforeAll(async () => {

    anvil = defineAnvil({
      forkUrl: MAINNET_FORK_URL,
      port: await getPort(),
      chainId: 1,
    });

    const _protocol = getProtocolWithState();

    await _protocol.sync();
    latestState = _protocol.dumpState();

    await anvil.start();

    vettingFees = await assetVettingFee(await anvil.pool(1).getProvider(), ENTRYPOINT_ADDRESS, nativeAsset);

  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  beforeEach(async () => {
  });

  it('[prepareUnshield] prepares withdrawal after deposit', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(10);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = createMockAspService();

    mockAspService.addLabels([0n, 1n, 2n]);

    // Create mock relayer
    const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

    const host = createMockHost(undefined, pool.rpcUrl);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      initialState: latestState,
      proverFactory: mockProverFactory,
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      aspServiceFactory: () => mockAspService,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH
    const WITHDRAW_AMOUNT = 500000000000000000n; // 0.5 ETH

    // 1. Deposit first
    const { txns: [shieldTx] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const receipt = await sendTxAndWait(alice, shieldTx);

    expect(receipt).toBeTruthy();
    expect(receipt!.status).toEqual(1);

    await pool.mine(1);

    // 2. Verify deposit balance
    const balanceAfterDeposit = await protocol.balance([nativeAsset]);
    const { pending } = unwrapBalance(balanceAfterDeposit, nativeAsset);

    expect(pending?.amount).toBe(deductVettingFees(DEPOSIT_AMOUNT, vettingFees));

    // 2.b Approve deposits
    const [note] = await protocol.notes([nativeAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(pool.rpcUrl,
      "0x" + ENTRYPOINT_ADDRESS.toString(16),
      "0x" + POSTMAN_ADDRESS.toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii" }
    );

    const balanceAfterDepositApproved = await protocol.balance([nativeAsset]);

    const { approved } = unwrapBalance(balanceAfterDepositApproved, nativeAsset);

    expect(approved?.amount).toBe(deductVettingFees(DEPOSIT_AMOUNT, vettingFees));

    // 3. Prepare withdrawal
    const recipientAccount = alice.address as AccountId;
    const withdrawOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    // 4. Verify withdrawal operation structure
    expect(withdrawOp.quoteData).toBeDefined();
    expect(withdrawOp.quoteData.quote).toBeDefined();
    expect(withdrawOp.quoteData.quote.feeBPS).toBe('100');
    expect(withdrawOp.quoteData.relayerId).toBe('mock-relayer');
    expect(withdrawOp.rawData).toBeDefined();
    expect(withdrawOp.rawData.proof).toBeDefined();
    expect(withdrawOp.txData).toBeDefined();
  });

  it('[prepareUnshield] selects lowest fee relayer', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(11);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = createMockAspService();

    mockAspService.addLabels([0n, 1n, 2n]);

    // Create two mock relayers with different fees
    const expensiveRelayer = createMockRelayerClient({ feeBPS: '500' });
    const cheapRelayer = createMockRelayerClient({ feeBPS: '50' });

    // We need a custom relayer client that routes based on URL
    const multiRelayerClient = {
      async getQuote(body: Parameters<typeof expensiveRelayer.getQuote>[0]) {
        if (body.relayerUrl.includes('expensive')) {
          return expensiveRelayer.getQuote(body);
        }

        return cheapRelayer.getQuote(body);
      },
      relay: cheapRelayer.relay,
      getFees: cheapRelayer.getFees,
    };

    const host = createMockHost(undefined, pool.rpcUrl);
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      relayersList: {
        'expensive-relayer': 'http://expensive.relayer',
        'cheap-relayer': 'http://cheap.relayer',
      },
      initialState: latestState,
      proverFactory: mockProverFactory,
      aspServiceFactory: () => mockAspService,
      relayerClientFactory: () => multiRelayerClient,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n;
    const WITHDRAW_AMOUNT = 500000000000000000n;

    // 1. Deposit
    const { txns: [shieldTx] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const receipt = await sendTxAndWait(alice, shieldTx);

    expect(receipt).toBeTruthy();
    expect(receipt!.status).toEqual(1);
    await pool.mine(1);

    // 2. Verify deposit balance (triggers sync)
    const balanceAfterDeposit = await protocol.balance([nativeAsset]);
    const { pending } = unwrapBalance(balanceAfterDeposit, nativeAsset);

    expect(pending?.amount).toBe(deductVettingFees(DEPOSIT_AMOUNT, vettingFees));

    // 2.b Approve deposits
    const [note] = await protocol.notes([nativeAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(pool.rpcUrl,
      "0x" + ENTRYPOINT_ADDRESS.toString(16),
      "0x" + POSTMAN_ADDRESS.toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii" }
    );

    const balanceAfterDepositApproved = await protocol.balance([nativeAsset]);
    const { approved } = unwrapBalance(balanceAfterDepositApproved, nativeAsset);

    expect(approved?.amount).toBe(deductVettingFees(DEPOSIT_AMOUNT, vettingFees));

    // 3. Prepare withdrawal - should select cheap relayer
    const recipientAccount = alice.address as AccountId;
    const withdrawOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    // 4. Verify cheapest relayer was selected
    expect(withdrawOp.quoteData.quote.feeBPS).toBe('50');
    expect(withdrawOp.quoteData.relayerId).toBe('cheap-relayer');
  });

  it('[prepareUnshield] throws when no sufficient balance', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(12);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = createMockAspService();

    mockAspService.addLabels([0n, 1n, 2n]);

    const mockRelayerClient = createMockRelayerClient();

    const host = createMockHost(undefined, pool.rpcUrl);
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      initialState: latestState,
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      proverFactory: mockProverFactory,
      aspServiceFactory: () => mockAspService,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const WITHDRAW_AMOUNT = 1000000000000000000n; // 1 ETH (no deposit made)

    // Try to withdraw without depositing first
    const recipientAccount = alice.address as AccountId;

    const balances = await protocol.balance([nativeAsset]);
    const { approved } = unwrapBalance(balances, nativeAsset);

    expect((approved?.amount ?? 0n) < WITHDRAW_AMOUNT).toBeTruthy();

    await expect(
      protocol.prepareUnshield(
        { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
        recipientAccount
      )
    ).rejects.toThrow('No note with sufficient balance');

  });

  it('[prepareUnshield] throws when all relayers fail', { timeout: 60_000 }, async () => {
    const pool = anvil.pool(13);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create a failing relayer
    const failingRelayer = createMockRelayerClient({ shouldFail: true });

    const host = createMockHost(undefined, pool.rpcUrl);
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      initialState: latestState,
      relayersList: { 'failing-relayer': 'http://failing.relayer' },
      relayerClientFactory: () => failingRelayer,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n;
    const WITHDRAW_AMOUNT = 500000000000000000n;

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
    await pool.mine(1);

    // 2. Try to withdraw - relayer should fail
    const recipientAccount = alice.address as AccountId;

    await expect(
      protocol.prepareUnshield(
        { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
        recipientAccount
      )
    ).rejects.toThrow('Failed to get quote from relayers');

  });

});
