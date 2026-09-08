import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { createPublicClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, parseEther, parseUnits, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS, PrivacyPoolsPaymasterConfigs } from '../../../src/config';
import { SIMPLE_7702_EXECUTE_ABI } from '../../../src/data/abis/account.abi';
import { DataService } from '../../../src/data/data.service';
import { EthClient } from '../../../src/data/eth-client';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { PrivacyPoolsBroadcaster } from '../../../src/plugin/broadcaster';
import { IChainsPaymastersConfig } from '../../../src/plugin/interfaces/protocol-params.interface';
import { addressToHex } from '../../../src/utils';
import { getChainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance, type AnvilPool } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { createSagaLogSource } from '../../utils/saga-log-source';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import {
  approveERC20,
  fundAccountWithERC20,
  getProtocolWithState,
  MOCK_IPFS_CID,
  pushNewAspRoot,
  sendTxAndWait,
  setupMockAspForTest,
  setupWallet,
} from '../../utils/test-helpers';

const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;

const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'] ?? 'https://saga.fatsolutions.xyz';
const chainId = inject('chainId');

// Fresh addresses (start empty) that only the tail calls pay. Lowercase so they
// pass viem's checksum validation when used directly in a tail call's `to`/args.
const FINAL_RECIPIENT = '0xfe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe01';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const TAIL_RECIPIENT_A = '0xaa00aa00aa00aa00aa00aa00aa00aa00aa00aa01';
const TAIL_RECIPIENT_B = '0xbb00bb00bb00bb00bb00bb00bb00bb00bb00bb02';

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster tail calls (real bundler, real prover)', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let latestState: InitialState;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;

  const { entrypoint, postman, rpcUrl } = getChainConfigSetup(1);
  const ENTRYPOINT_ADDRESS = entrypoint.address;

  beforeAll(async () => {
    anvil = await defineAnvil({ forkUrl: rpcUrl, chainId: 1 });
    await anvil.start();

    pool = anvil.pool(1);

    await pool.setBalance(new Wallet(EXECUTOR_PK).address, `0x${parseEther('100').toString(16)}`);
    await pool.setBalance(new Wallet(UTILITY_PK).address, `0x${parseEther('100').toString(16)}`);

    ({ bundlerRpcUrl, stop: stopBundler } = await startServers({
      execRpcUrl: pool.rpcUrl,
      entrypoint: PrivacyPoolsPaymasterConfigs[1]!.entryPointAddress,
      executorPrivateKey: EXECUTOR_PK,
      utilityPrivateKey: UTILITY_PK,
      port: 8546,
    }));

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

  it('[paymaster] pays the withdrawal to the sender and forwards it via a tail call', { timeout: 300_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const provider = await pool.getProvider();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const nativeAsset = ERC20Asset(E_ADDRESS);

    const paymasterConfig: IChainsPaymastersConfig = {
      1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl },
    };

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(),
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });

    const DEPOSIT_AMOUNT = parseEther('2');
    const WITHDRAW_AMOUNT = parseEther('1');
    const FORWARD_AMOUNT = parseEther('0.5'); // safely below WITHDRAW_AMOUNT - fee

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

    // 3. Prepare a sponsored withdrawal with a forwarding tail call. The
    //    withdrawal pays the ephemeral sender; the tail call then forwards part
    //    of it to a fresh recipient.
    const op = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      FINAL_RECIPIENT as AccountId,
      {
        mode: 'paymaster',
        tailCalls: async () => [{ to: FINAL_RECIPIENT, value: FORWARD_AMOUNT, data: '0x' }],
      },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    // The execution phase is populated (execute()), unlike the no-tail-call flow.
    expect(op.withdrawal.userOperation.callData).not.toBe('0x');
    // The sender is distinct from the final recipient (the adapter paid the sender).
    expect(op.withdrawal.userOperation.sender.toLowerCase()).not.toBe(FINAL_RECIPIENT.toLowerCase());

    const recipientBefore = await provider.getBalance(FINAL_RECIPIENT);

    expect(recipientBefore).toBe(0n);

    // 4. Broadcast + mine.
    await broadcaster.broadcast(op);
    await pool.mine(1);

    // 5. The tail call delivered exactly FORWARD_AMOUNT to the fresh recipient,
    //    and the note was spent.
    const recipientAfter = await provider.getBalance(FINAL_RECIPIENT);
    const approvedAfter = unwrapBalance(await protocol.balance([nativeAsset]), nativeAsset).approved?.amount ?? 0n;

    expect(recipientAfter).toBe(FORWARD_AMOUNT);
    expect(approvedAfter).toBe(approvedBefore - WITHDRAW_AMOUNT);
  });

  it('[paymaster] batches two ERC20 transfers as executeBatch tail calls', { timeout: 300_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const rpc = createPublicClient({ transport: http(pool.rpcUrl) });
    const usdcAsset = ERC20Asset(USDC);

    const paymasterConfig: IChainsPaymastersConfig = {
      1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl },
    };

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(),
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });

    const DEPOSIT_AMOUNT = parseUnits('300', 6); // USDC, 6 decimals
    const WITHDRAW_AMOUNT = parseUnits('200', 6);
    const TRANSFER_A = parseUnits('50', 6);
    const TRANSFER_B = parseUnits('40', 6);

    const usdcBalance = (address: string) =>
      rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] });

    // 1. Fund + approve + deposit USDC.
    await fundAccountWithERC20(pool.rpcUrl, USDC, alice.address, DEPOSIT_AMOUNT);
    expect((await approveERC20(alice, USDC, addressToHex(ENTRYPOINT_ADDRESS), DEPOSIT_AMOUNT))?.status).toBe(1);

    const { txns: [shieldTx] } = await protocol.prepareShield({ asset: usdcAsset, amount: DEPOSIT_AMOUNT });

    expect((await sendTxAndWait(alice, shieldTx))?.status).toBe(1);
    await pool.mine(1);

    // 2. Approve the note via the mock ASP.
    const [note] = await protocol.notes([usdcAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(
      pool.rpcUrl,
      '0x' + ENTRYPOINT_ADDRESS.toString(16),
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    const approvedBefore = unwrapBalance(await protocol.balance([usdcAsset]), usdcAsset).approved?.amount ?? 0n;

    expect(approvedBefore).toBeGreaterThanOrEqual(WITHDRAW_AMOUNT);

    // 3. Two ERC20 transfers as tail calls (spent from the sender, which the
    //    adapter funded) — forces the executeBatch path.
    const erc20Transfer = (to: string, amount: bigint) => ({
      to: USDC,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as `0x${string}`, amount] }),
    });

    const op = await protocol.prepareUnshield(
      { asset: usdcAsset, amount: WITHDRAW_AMOUNT },
      TAIL_RECIPIENT_A as AccountId,
      {
        mode: 'paymaster',
        tailCalls: async () => [erc20Transfer(TAIL_RECIPIENT_A, TRANSFER_A), erc20Transfer(TAIL_RECIPIENT_B, TRANSFER_B)],
      },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    // The execution phase is an executeBatch of the two transfers.
    const decoded = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: op.withdrawal.userOperation.callData });

    expect(decoded.functionName).toBe('executeBatch');
    expect((decoded.args[0] as readonly unknown[]).length).toBe(2);

    const [a0, b0] = await Promise.all([usdcBalance(TAIL_RECIPIENT_A), usdcBalance(TAIL_RECIPIENT_B)]);

    // 4. Broadcast + mine.
    await broadcaster.broadcast(op);
    await pool.mine(1);

    // 5. Both transfers landed for their exact amounts, and the note was spent.
    const [a1, b1] = await Promise.all([usdcBalance(TAIL_RECIPIENT_A), usdcBalance(TAIL_RECIPIENT_B)]);
    const approvedAfter = unwrapBalance(await protocol.balance([usdcAsset]), usdcAsset).approved?.amount ?? 0n;

    expect(a1 - a0).toBe(TRANSFER_A);
    expect(b1 - b0).toBe(TRANSFER_B);
    expect(approvedAfter).toBe(approvedBefore - WITHDRAW_AMOUNT);
  });
});
