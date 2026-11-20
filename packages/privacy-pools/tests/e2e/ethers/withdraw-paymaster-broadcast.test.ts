import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS, PrivacyPoolsPaymasterConfigs } from '../../../src/config';
import { DataService } from '../../../src/data/data.service';
import { EthClient } from '../../../src/data/eth-client';
import { PaymasterBroadcastError, PrivacyPoolsV1Protocol } from '../../../src/index';
import { PrivacyPoolsBroadcaster } from '../../../src/plugin/broadcaster';
import { IChainsPaymastersConfig } from '../../../src/plugin/interfaces/protocol-params.interface';
import { getChainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance, type AnvilPool } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { createSagaLogSource } from '../../utils/saga-log-source';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import {
  fundAccountWithERC20,
  getProtocolWithState,
  MOCK_IPFS_CID,
  pushNewAspRoot,
  sendTxAndWait,
  setupMockAspForTest,
  setupWallet,
} from '../../utils/test-helpers';

// alto bundler operator keys (funded on the fork below).
const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;

const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'] ?? 'https://saga.fatsolutions.xyz';
const chainId = inject('chainId');

// Fresh recipient (starts at 0 ETH) so the sponsored payout is unambiguous.
const RECIPIENT = '0xfE0fe0Fe0fe0fe0fE0fe0fe0Fe0fE0Fe0fE0fe00';

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster broadcast (real bundler, real prover)', () => {
  let anvil: AnvilInstance;
  // One shared fork instance: the bundler, state hydration, and the test's
  // deposit/withdrawal must all run on the SAME chain, or the userOp executes
  // against a fork that never saw the deposit (UnknownStateRoot).
  let pool: AnvilPool;
  let latestState: InitialState;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;

  const { entrypoint, postman, rpcUrl } = getChainConfigSetup(1);
  const ENTRYPOINT_ADDRESS = entrypoint.address;
  const PAYMASTER_ADDRESS = PrivacyPoolsPaymasterConfigs[1]!.paymasterAddress;

  beforeAll(async () => {
    anvil = await defineAnvil({ forkUrl: rpcUrl, chainId: 1 });
    await anvil.start();

    pool = anvil.pool(1);

    // Fund the bundler's executor/utility EOAs so alto can submit bundles.
    await pool.setBalance(new Wallet(EXECUTOR_PK).address, `0x${parseEther('100').toString(16)}`);
    await pool.setBalance(new Wallet(UTILITY_PK).address, `0x${parseEther('100').toString(16)}`);

    // Start alto pointed at this fork.
    ({ bundlerRpcUrl, stop: stopBundler } = await startServers({
      execRpcUrl: pool.rpcUrl,
      entrypoint: PrivacyPoolsPaymasterConfigs[1]!.entryPointAddress,
      executorPrivateKey: EXECUTOR_PK,
      utilityPrivateKey: UTILITY_PK,
      port: 8546,
    }));

    // Fast state hydration via saga (pool leaves) + RPC (entrypoint/tail).
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const rpcLogs = new EthClient(host.provider);
    const sagaLogs = await createSagaLogSource({
      sourceUrl: SAGA_SYNC_URL,
      chainId: 1,
      headBlock: BigInt(await pool.getBlockNumber()),
      fallback: (params) => rpcLogs.getLogs(params),
    });

    const { protocol } = await getProtocolWithState({
      entrypoint,
      initialState: () => loadInitialState(1),
      host,
      rpcUrl: pool.rpcUrl,
      postman,
      dataService: new DataService({ provider: host.provider, getLogs: sagaLogs }),
    });

    await protocol.sync();
    latestState = protocol.dumpState();
  }, 600000);

  afterAll(async () => {
    await stopBundler?.();
    await anvil.stop();
  });

  it('[paymaster] broadcasts a native withdrawal through the bundler', { timeout: 300_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const provider = await pool.getProvider();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const nativeAsset = ERC20Asset(E_ADDRESS);

    // Route sponsored withdrawals to our local alto bundler.
    const paymasterConfig: IChainsPaymastersConfig = {
      1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl },
    };

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(), // real proof — required for on-chain acceptance
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });

    const DEPOSIT_AMOUNT = parseEther('2');
    const WITHDRAW_AMOUNT = parseEther('1');

    // 1. Deposit.
    const { txns: [shieldTx] } = await protocol.prepareShield({ asset: nativeAsset, amount: DEPOSIT_AMOUNT });

    expect((await sendTxAndWait(alice, shieldTx))?.status).toBe(1);
    await pool.mine(1);

    // 2. Approve the note via the mock ASP.
    const [note] = await protocol.notes([nativeAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(
      pool.rpcUrl,
      '0x' + ENTRYPOINT_ADDRESS.toString(16),
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    const approvedBefore = unwrapBalance(await protocol.balance([nativeAsset]), nativeAsset).approved?.amount ?? 0n;

    expect(approvedBefore).toBeGreaterThanOrEqual(WITHDRAW_AMOUNT);

    // 3. Prepare the sponsored withdrawal (real gas price from alto, real proof).
    const op = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      RECIPIENT as AccountId,
      { mode: 'paymaster' },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    const recipientBefore = await provider.getBalance(RECIPIENT);
    const paymasterBefore = await provider.getBalance(PAYMASTER_ADDRESS);

    expect(recipientBefore).toBe(0n);

    // 4. Broadcast for real through the bundler, then mine the bundle.
    await (await broadcaster.broadcast(op)).wait();
    await pool.mine(1);

    // 5. Assert on-chain effects.
    const recipientAfter = await provider.getBalance(RECIPIENT);
    const paymasterAfter = await provider.getBalance(PAYMASTER_ADDRESS);
    const approvedAfter = unwrapBalance(await protocol.balance([nativeAsset]), nativeAsset).approved?.amount ?? 0n;

    // Recipient received the withdrawal minus the sponsored-gas fee.
    expect(recipientAfter).toBeGreaterThan(0n);
    expect(recipientAfter).toBeLessThan(WITHDRAW_AMOUNT);
    // Paymaster collected the fee.
    expect(paymasterAfter).toBeGreaterThan(paymasterBefore);
    // The note was spent.
    expect(approvedAfter).toBe(approvedBefore - WITHDRAW_AMOUNT);
  });

  it('[paymaster] reports staleNonce when the bundler refuses a withdrawal whose sender nonce moved', { timeout: 300_000 }, async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const usdcAsset = ERC20Asset(USDC);
    const DEPOSIT_AMOUNT = parseUnits('300', 6);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(),
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig: { 1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl } },
    });

    await fundAccountWithERC20(pool.rpcUrl, USDC, alice.address, DEPOSIT_AMOUNT);

    for (const tx of (await protocol.prepareShield({ asset: usdcAsset, amount: DEPOSIT_AMOUNT })).txns) {
      expect((await sendTxAndWait(alice, tx))?.status).toBe(1);
    }

    await pool.mine(1);

    const [note] = await protocol.notes([usdcAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(
      pool.rpcUrl,
      '0x' + ENTRYPOINT_ADDRESS.toString(16),
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    // A wallet sender, whose own transactions move its EIP-7702 authorization nonce.
    const wallet = privateKeyToAccount(generatePrivateKey());
    const client = createPublicClient({ chain: mainnet, transport: http(pool.rpcUrl) });

    await pool.setBalance(wallet.address, `0x${parseEther('1').toString(16)}`);

    // Empty tail calls take the estimated execution path that external signing requires.
    const prepare = () => protocol.prepareUnshield(
      { asset: usdcAsset, amount: DEPOSIT_AMOUNT / 2n },
      RECIPIENT as AccountId,
      { mode: 'paymaster', delegation: { mode: 'external', signer: wallet }, tailCalls: async () => [] },
    );
    const stale = await prepare();
    const hash = await createWalletClient({ account: wallet, chain: mainnet, transport: http(pool.rpcUrl) }).sendTransaction({ to: wallet.address, value: 0n });

    await client.waitForTransactionReceipt({ hash });

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });
    const error = await broadcaster.broadcast(stale).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PaymasterBroadcastError);
    expect(error).toMatchObject({ failure: 'not-accepted', staleNonce: { kind: 'authorization', signed: 0n, current: 1n } });
    expect((error as Error).message).toContain('sync before preparing another withdrawal');

    // Here the earlier outcome is known: only a plain transaction moved the nonce, so the note is unspent and preparing again lands.
    const approvedBalance = async () => unwrapBalance(await protocol.balance([usdcAsset]), usdcAsset).approved?.amount ?? 0n;
    const approvedBefore = await approvedBalance();

    await (await broadcaster.broadcast(await prepare())).wait();
    await pool.mine(1);

    expect(await approvedBalance()).toBe(approvedBefore - DEPOSIT_AMOUNT / 2n);
  });
});
