import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId, ERC20AssetId, Host } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { createPublicClient, erc20Abi, http, parseEther, parseUnits, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { E_ADDRESS, PrivacyPoolsPaymasterConfigs } from '../../../src/config';
import { DataService } from '../../../src/data/data.service';
import { EthClient } from '../../../src/data/eth-client';
import { PaymasterBroadcastError, PrivacyPoolsV1Protocol } from '../../../src/index';
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

// alto bundler operator keys (funded on the fork below).
const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;

const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'] ?? 'https://saga.fatsolutions.xyz';
const chainId = inject('chainId');

// Fresh recipient (starts empty) so payouts are unambiguous.
const RECIPIENT = '0xfE0fe0Fe0fe0fe0fE0fe0fe0Fe0fE0Fe0fE0fe00';

// One asset per test, so each test's deterministic deposit note never collides
// with another test's note re-derived from the shared baseline state.
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDT_BALANCE_SLOT = 2;

/**
 * Forwards every `eth_sendUserOperation` to the bundler but throws instead of
 * returning its response, as when a request times out after the bundler got it.
 * viem retries the send, so every attempt is dropped.
 */
const dropSendResponses = (host: Host) => {
  const methods: string[] = [];
  const network = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await host.network.fetch(input, init);
      const { method } = JSON.parse(String(init?.body ?? '{}'));

      methods.push(method);

      if (method === 'eth_sendUserOperation') throw new Error('socket hang up');

      return response;
    },
  };

  return { host: { ...host, network } as Host, methods };
};

const catchBroadcastError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => { throw new Error('expected a rejection'); },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(PaymasterBroadcastError);

  return error as PaymasterBroadcastError;
};

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster broadcast failures (real bundler, real prover)', () => {
  let anvil: AnvilInstance;
  // One shared fork: the bundler, state hydration, and the tests must all run on
  // the same chain.
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

  /** Deposits `amount` of `asset` and approves the note via the mock ASP. */
  const depositApprovedNote = async (asset: ERC20AssetId, amount: bigint, erc20?: { token: string; balanceSlot?: number }) => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);
    const paymasterConfig: IChainsPaymastersConfig = {
      1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl },
    };
    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => Prover(), // real proof — required for on-chain acceptance
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    if (erc20) {
      await fundAccountWithERC20(pool.rpcUrl, erc20.token, alice.address, amount, erc20.balanceSlot);
      expect((await approveERC20(alice, erc20.token, addressToHex(ENTRYPOINT_ADDRESS), amount))?.status).toBe(1);
    }

    const { txns } = await protocol.prepareShield({ asset, amount });

    // An ERC20 deposit may be preceded by an allowance tx; the deposit is last.
    for (const tx of txns) {
      expect((await sendTxAndWait(alice, tx))?.status).toBe(1);
    }

    await pool.mine(1);

    const [note] = await protocol.notes([asset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(
      pool.rpcUrl,
      '0x' + ENTRYPOINT_ADDRESS.toString(16),
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    const approvedBalance = async () => unwrapBalance(await protocol.balance([asset]), asset).approved?.amount ?? 0n;

    return { host, protocol, approvedBalance };
  };

  it('[paymaster] recovers a userOp whose send responses were lost', { timeout: 300_000 }, async () => {
    const nativeAsset = ERC20Asset(E_ADDRESS);
    const WITHDRAW_AMOUNT = parseEther('1');
    const { host, protocol, approvedBalance } = await depositApprovedNote(nativeAsset, parseEther('2'));
    const provider = await pool.getProvider();

    const op = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      RECIPIENT as AccountId,
      { mode: 'paymaster' },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    const lossy = dropSendResponses(host);
    const broadcaster = new PrivacyPoolsBroadcaster({ host: lossy.host, broadcasterUrl: { default: 'http://unused' } });
    const approvedBefore = await approvedBalance();

    // Every send response is lost, so only the lookup of the hash computed at
    // signing can tell that the bundler accepted it.
    const response = await broadcaster.broadcast(op);

    expect(lossy.methods).toContain('eth_getUserOperationByHash');
    expect(response.requestId).toBe(op.withdrawal.userOpHash);

    const { txHash } = await response.wait();

    await pool.mine(1);

    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await provider.getBalance(RECIPIENT)).toBeGreaterThan(0n);
    expect(await approvedBalance()).toBe(approvedBefore - WITHDRAW_AMOUNT);
  });

  it('[paymaster] throws `not-accepted` when the bundler rejects the userOp', { timeout: 300_000 }, async () => {
    const usdcAsset = ERC20Asset(USDC);
    const { host, protocol, approvedBalance } = await depositApprovedNote(usdcAsset, parseUnits('300', 6), { token: USDC });

    const op = await protocol.prepareUnshield(
      { asset: usdcAsset, amount: parseUnits('200', 6) },
      RECIPIENT as AccountId,
      { mode: 'paymaster' },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    // An invalid sender signature fails validation, so the bundler rejects it.
    const badSignature = `0x${'ab'.repeat(65)}` as const;

    op.withdrawal.userOperation.signature = badSignature;

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });
    const approvedBefore = await approvedBalance();
    const error = await catchBroadcastError(broadcaster.broadcast(op));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toMatch(/AA\d\d/);
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain(badSignature);
    expect(error.message).not.toContain(op.withdrawal.userOperation.paymasterData!.slice(2, 66));

    await pool.mine(1);

    // Nothing was spent.
    expect(await approvedBalance()).toBe(approvedBefore);
  });

  it('[paymaster] throws `reverted` when the userOp reverts after spending the note', { timeout: 300_000 }, async () => {
    const usdtAsset = ERC20Asset(USDT);
    const WITHDRAW_AMOUNT = parseUnits('200', 6);
    const { host, protocol, approvedBalance } = await depositApprovedNote(
      usdtAsset,
      parseUnits('300', 6),
      { token: USDT, balanceSlot: USDT_BALANCE_SLOT },
    );
    const rpc = createPublicClient({ transport: http(pool.rpcUrl) });

    // The withdrawal pays the sender during validation. USDT has no fallback,
    // so this tail call reverts the execution phase afterwards.
    const op = await protocol.prepareUnshield(
      { asset: usdtAsset, amount: WITHDRAW_AMOUNT },
      RECIPIENT as AccountId,
      {
        mode: 'paymaster',
        tailCalls: async () => [{ to: USDT, value: 0n, data: '0xdeadbeef' }],
      },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });
    const approvedBefore = await approvedBalance();

    // The bundler accepts it: only the execution phase reverts.
    const response = await broadcaster.broadcast(op);
    const error = await catchBroadcastError(response.wait());

    await pool.mine(1);

    expect(error.failure).toBe('reverted');
    expect(error.userOpHash).toBe(op.withdrawal.userOpHash);
    expect(error.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // The note was spent anyway, and its funds are held by the sender.
    const senderBalance = await rpc.readContract({
      address: USDT,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [op.withdrawal.userOperation.sender],
    });

    expect(await approvedBalance()).toBe(approvedBefore - WITHDRAW_AMOUNT);
    expect(senderBalance).toBeGreaterThan(0n);
  });
});
