import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS } from '../../../src/config';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { chainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';

import { createMockHost } from '../../utils/mock-host';
import { createMockRelayerClient } from '../../utils/mock-relayer';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { assetVettingFee, deductVettingFees, getProtocolWithState, MOCK_IPFS_CID, pushNewAspRoot, sendTxAndWait, setupMockAspForTest, setupWallet } from '../../utils/test-helpers';


describe('PrivacyPools v1 Unshield E2E (Real Prover)', () => {
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

  it('[prepareUnshield] prepares withdrawal with real prover after deposit', { timeout: 300000 }, async () => {
    const pool = anvil.pool(20);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    // Create mock relayer
    const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: latestState,
      proverFactory: () => Prover(), // Use real prover
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

    const txReceipt = await sendTxAndWait(alice, shieldTx);

    expect(txReceipt).toBeTruthy();
    expect(txReceipt!.status).toEqual(1);
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

    // 3. Prepare withdrawal with real prover
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

    // Verify real proof structure (not mocked zeros)
    const { proof, context } = withdrawOp.rawData;

    expect(proof.proof).toBeDefined();
    expect(proof.publicSignals).toBeDefined();
    expect(proof.publicSignals.length).toBeGreaterThan(0);

    expect(proof.mappedSignals.withdrawnValue).toEqual(WITHDRAW_AMOUNT);
    expect(proof.mappedSignals.context).toEqual(context);

    expect(withdrawOp.txData).toBeDefined();
  }); // Extended timeout for real proof generation

  it('[prepareUnshield] prepares withdrawal with real prover after deposit and withdraws', { timeout: 300000 }, async () => {
    const pool = anvil.pool(21);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    // Create mock relayer
    const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: latestState,
      proverFactory: () => Prover(), // Use real prover
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

    const txReceipt = await sendTxAndWait(alice, shieldTx);

    expect(txReceipt).toBeTruthy();
    expect(txReceipt!.status).toEqual(1);
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

    // 3. Prepare withdrawal with real prover
    const recipientAccount = alice.address as AccountId;
    const withdrawOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      recipientAccount
    );

    // 4.
    const receipt = await sendTxAndWait(alice, withdrawOp.txData);

    await pool.mine(1);
    expect(receipt).toBeTruthy();
    expect(receipt!.status).toEqual(1);

  }); // Extended timeout for real proof generation

  it('[prepareUnshield] prepares withdrawal with real prover after deposit and withdraws multiple times', { timeout: 300_000 }, async () => {
    const pool = anvil.pool(22);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    // Create mock asp
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    // Create mock relayer
    const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: latestState,
      proverFactory: () => Prover(), // Use real prover
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      aspServiceFactory: () => mockAspService,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH
    const WITHDRAW_AMOUNT = 100000000000000000n; // 0.1 ETH

    // 1. Deposit first
    const { txns: [shieldTx] } = await protocol.prepareShield(
      { asset: nativeAsset, amount: DEPOSIT_AMOUNT }
    );

    const txReceipt = await sendTxAndWait(alice, shieldTx);

    expect(txReceipt).toBeTruthy();
    expect(txReceipt!.status).toEqual(1);
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


    const provider = await pool.getProvider();
    const withdrawNumber = 4;
    const recipientAddress = "0xfE0fe0Fe0fe0fe0fE0fe0fe0Fe0fE0Fe0fE0fe00";
    const recipientAccount = recipientAddress as AccountId;
    let receiverBalance = 0n;

    // reciever starts with 0 ETH
    expect(await provider.getBalance(recipientAddress)).toEqual(receiverBalance);

    for (const i in Array(withdrawNumber).fill(null)) {

      // We withdraw 0.1 at a time, until the last one in which we take out the rest.
      const withdraw_amount = (Number(i) + 1) === withdrawNumber ? pending!.amount - 3n * WITHDRAW_AMOUNT : WITHDRAW_AMOUNT;

      // 3. Prepare withdrawal with real prover
      const withdrawOp = await protocol.prepareUnshield(
        { asset: nativeAsset, amount: withdraw_amount },
        recipientAccount
      );

      receiverBalance += withdraw_amount - (withdraw_amount * BigInt(withdrawOp.quoteData.quote.feeBPS)) / 10_000n;

      // 4.
      const receipt = await sendTxAndWait(alice, withdrawOp.txData);

      await pool.mine(1);
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
      expect(await provider.getBalance(recipientAddress)).toEqual(receiverBalance);

    }

    // shielded balance should be 0
    const balanceAfterWithdraws = await protocol.balance([nativeAsset]);
    const { approved: finalApproved } = unwrapBalance(balanceAfterWithdraws, nativeAsset);

    expect(finalApproved?.amount).toBe(0n);

  }); // Extended timeout for real proof generation

});
