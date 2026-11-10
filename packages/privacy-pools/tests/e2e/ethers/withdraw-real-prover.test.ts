import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { Contract } from 'ethers';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS } from '../../../src/config';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { addressToHex } from '../../../src/utils';
import { getChainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';

import { createMockHost } from '../../utils/mock-host';
import { createMockRelayerClient } from '../../utils/mock-relayer';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { approveERC20, assetVettingFee, deductVettingFees, getProtocolWithState, MOCK_IPFS_CID, pushNewAspRoot, sendTxAndWait, setupMockAspForTest, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';


describe('PrivacyPools v1 Unshield E2E (Real Prover)', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const chainId = inject('chainId');
  const {
    entrypoint,
    erc20Address,
    erc20WhaleAddress,
    forkBlockNumber,
    postman,
    rpcUrl
  } = getChainConfigSetup(chainId);

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
      initialState: () => loadInitialState(chainId),
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
      initialState: async () => latestState,
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
      initialState: async () => latestState,
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

  it('[prepareUnshield exact] delivers exactly the requested net to the recipient on-chain (native, real prover)', { timeout: 300_000 }, async () => {
    const pool = anvil.pool(23);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const provider = await pool.getProvider();

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);
    // Gas-adjusted quote below the on-chain cap (maxRelayFeeBPS = 100): 0.3% base + 0.001
    // ETH gas => ~0.5% total at 0.5 ETH, leaving room for the default gas bump.
    const mockRelayerClient = createMockRelayerClient({ baseFeeBPS: '30', gasFee: '1000000000000000' });
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(), // Use real prover so the built tx passes the on-chain verifier
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      aspServiceFactory: () => mockAspService,
    });

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = 1000000000000000000n; // 1 ETH
    const REQUESTED_OUTPUT = 500000000000000000n; // recipient must receive exactly 0.5 ETH

    // 1. Deposit + approve
    const { txns: [shieldTx] } = await protocol.prepareShield({ asset: nativeAsset, amount: DEPOSIT_AMOUNT });

    expect((await sendTxAndWait(alice, shieldTx))?.status).toEqual(1);
    await pool.mine(1);

    const [note] = await protocol.notes([nativeAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(pool.rpcUrl,
      "0x" + ENTRYPOINT_ADDRESS.toString(16),
      "0x" + POSTMAN_ADDRESS.toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID }
    );

    // 2. Exact-output withdrawal to a fresh recipient (starts at 0), so the delivered
    // amount is unambiguous. The default gas bump applies: the quote (~50 bps) plus the
    // bumped gas stays under the on-chain cap (100 bps).
    const recipientAddress = "0xfe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe01";

    expect(await provider.getBalance(recipientAddress)).toEqual(0n);

    const op = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: REQUESTED_OUTPUT },
      recipientAddress as AccountId,
      { exact: {} },
    );

    // 3. Execute the built Entrypoint tx and confirm the recipient received EXACTLY the
    // requested net — the whole point of exact-output mode, verified end to end.
    const receipt = await sendTxAndWait(alice, op.txData);

    await pool.mine(1);
    expect(receipt?.status).toEqual(1);
    expect(op.exact!.expectedNet).toEqual(REQUESTED_OUTPUT);
    expect(await provider.getBalance(recipientAddress)).toEqual(REQUESTED_OUTPUT);

    // The embedded fee is base + bumped gas (not degenerate) and under the on-chain cap.
    const relayFeeBps = (op as { rawData: { relayData: { relayFeeBps: bigint } } }).rawData.relayData.relayFeeBps;

    expect(relayFeeBps).toBeGreaterThan(30n);
    expect(relayFeeBps).toBeLessThan(100n);
  });

  it.skipIf(chainId !== 11155111)('[prepareUnshield exact] delivers exactly the requested net for an ERC20 (USDT) on-chain (real prover)', { timeout: 300_000 }, async () => {
    const pool = anvil.pool(24);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const provider = await pool.getProvider();

    const entrypointHex = addressToHex(ENTRYPOINT_ADDRESS);
    const usdtAsset = ERC20Asset(erc20Address);
    const usdt = new Contract(erc20Address, ['function balanceOf(address) view returns (uint256)'], provider);

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);
    // Gas-adjusted quote (0.3% base + 2 USDT gas) well below USDT's on-chain cap (3000 bps),
    // so the default gas bump applies.
    const mockRelayerClient = createMockRelayerClient({ baseFeeBPS: '30', gasFee: '2000000' });
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(), // Use real prover so the built tx passes the on-chain verifier
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      aspServiceFactory: () => mockAspService,
    });

    const DEPOSIT_AMOUNT = 1_000_000_000n; // 1,000 USDT (6 decimals)
    const REQUESTED_OUTPUT = 500_000_000n; // recipient must receive exactly 500 USDT

    // 1. Fund alice with USDT from the whale, approve the entrypoint, deposit.
    await transferERC20FromWhale(pool.rpcUrl, erc20Address, erc20WhaleAddress, alice.address, DEPOSIT_AMOUNT);
    expect((await approveERC20(alice, erc20Address, entrypointHex, DEPOSIT_AMOUNT)).status).toEqual(1);

    const { txns: [shieldTx] } = await protocol.prepareShield({ asset: usdtAsset, amount: DEPOSIT_AMOUNT });

    expect((await sendTxAndWait(alice, shieldTx))?.status).toEqual(1);
    await pool.mine(1);

    // 2. Approve the note via the mock ASP.
    const [note] = await protocol.notes([usdtAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(pool.rpcUrl,
      entrypointHex,
      "0x" + POSTMAN_ADDRESS.toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID }
    );

    // 3. Exact-output withdrawal to a fresh recipient (starts at 0 USDT).
    const recipientAddress = "0xfe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe02";

    expect(await usdt.balanceOf(recipientAddress)).toEqual(0n);

    const op = await protocol.prepareUnshield(
      { asset: usdtAsset, amount: REQUESTED_OUTPUT },
      recipientAddress as AccountId,
      { exact: {} },
    );

    // 4. Execute the built Entrypoint tx; the recipient must receive EXACTLY the requested
    // net in USDT, verified end to end.
    const receipt = await sendTxAndWait(alice, op.txData);

    await pool.mine(1);
    expect(receipt?.status).toEqual(1);
    expect(op.exact!.expectedNet).toEqual(REQUESTED_OUTPUT);
    expect(await usdt.balanceOf(recipientAddress)).toEqual(REQUESTED_OUTPUT);

    const relayFeeBps = (op as { rawData: { relayData: { relayFeeBps: bigint } } }).rawData.relayData.relayFeeBps;

    expect(relayFeeBps).toBeGreaterThan(30n); // base + gas
    expect(relayFeeBps).toBeLessThan(3000n); // under USDT's on-chain cap
  });

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
      initialState: async () => latestState,
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
