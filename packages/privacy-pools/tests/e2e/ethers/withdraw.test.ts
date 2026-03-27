import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';

import { E_ADDRESS } from '../../../src/config';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { chainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';

import { createMockHost } from '../../utils/mock-host';
import { mockProverFactory } from '../../utils/mock-prover';
import { createMockRelayerClient } from '../../utils/mock-relayer';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { assetVettingFee, deductVettingFees, getProtocolWithState, MOCK_IPFS_CID, pushNewAspRoot, sendTxAndWait, setupMockAspForTest, setupWallet } from '../../utils/test-helpers';


describe('PrivacyPools v1 Unshield E2E', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const chainId = inject('chainId');
  const {
    entrypoint,
    forkBlockNumber,
    postman,
    rpcUrl
  } = chainConfigSetup[chainId];

  const ENTRYPOINT_ADDRESS = entrypoint.address;
  const POSTMAN_ADDRESS = BigInt(postman);

  const nativeAsset = ERC20Asset(E_ADDRESS);
  let vettingFees = 0n;

  beforeAll(async () => {

    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber: Number(forkBlockNumber),
      chainId,
    });

    await anvil.start();

    const pool = anvil.pool(1);
    const { protocol: _protocol } = await getProtocolWithState({
      entrypoint,
      initialState: await loadInitialState(chainId),
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      rpcUrl: pool.rpcUrl,
      postman,
    });

    await _protocol.sync();
    latestState = _protocol.dumpState();

    vettingFees = await assetVettingFee({
      provider: await pool.getProvider(),
      entrypointAddress: ENTRYPOINT_ADDRESS,
      asset: nativeAsset
    });

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
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    // Create mock relayer
    const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
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
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID }
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
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

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

    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
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
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID }
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
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const mockRelayerClient = createMockRelayerClient();

    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
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

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: latestState,
      relayersList: { 'failing-relayer': 'http://failing.relayer' },
      relayerClientFactory: () => failingRelayer,
      aspServiceFactory: () => mockAspService,
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
