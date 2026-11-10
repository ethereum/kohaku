import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AccountId, Host } from '@kohaku-eth/plugins';
import { TxData } from '@kohaku-eth/provider';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { parseEther, type Hex } from 'viem';

import { createTCBroadcaster, E_ADDRESS, PaymasterBroadcastError, TornadoCashProtocol } from '@kohaku-eth/tornado-cash';
import { createPaymasterBundlerClient, serializedUserOperationHash } from '../../../src/paymaster/utils';
import { AnvilPool, defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, loadInitialState } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getProtocolWithState, sendMultipleTxsAndWait, setupWallet } from '../../utils/test-helpers';
import { getPaymasterChainConfigSetup } from '../../constants';

const DEPLOYER_PK = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as Hex;
const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK  = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;
const HUNDRED_ETH = `0x${parseEther('100').toString(16)}`;
const NOTE = parseEther('1');

// Empty when the withdrawal is prepared, so the tail call estimates fine.
const REVERT_TARGET = '0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e';
// PUSH1 0 PUSH1 0 REVERT
const ALWAYS_REVERTS = '0x60006000fd';

/**
 * Forwards every `eth_sendUserOperation` to the bundler but throws instead of
 * returning its response, as when a request times out after the bundler got it.
 * The dropped responses are kept in `dropped`.
 */
const dropSendResponses = (host: Host) => {
  const methods: string[] = [];
  const dropped: unknown[] = [];
  const network = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await host.network.fetch(input, init);
      const { method } = JSON.parse(String(init?.body ?? '{}'));

      methods.push(method);

      if (method === 'eth_sendUserOperation') {
        dropped.push(await response.json());
        throw new Error('socket hang up');
      }

      return response;
    },
  };

  return { host: { ...host, network } as Host, methods, dropped };
};

const catchBroadcastError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => { throw new Error('expected a rejection'); },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(PaymasterBroadcastError);

  return error as PaymasterBroadcastError;
};

describe('TornadoCash paymaster broadcast failures (real bundler, real prover)', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;
  let host: Host;
  let protocol: TornadoCashProtocol;

  const chainId = inject('chainId');
  const { forkBlockNumber, rpcUrl, paymasterConfig } = getPaymasterChainConfigSetup(chainId);
  const { entryPointAddress } = paymasterConfig;
  const nativeAsset = ERC20Asset(E_ADDRESS);

  beforeAll(async () => {
    anvil = await defineAnvil({ forkUrl: rpcUrl, forkBlockNumber: Number(forkBlockNumber), chainId });
    await anvil.start();
    pool = anvil.pool(1);

    await pool.setBalance(new Wallet(DEPLOYER_PK).address, HUNDRED_ETH);
    await pool.setBalance(new Wallet(EXECUTOR_PK).address, HUNDRED_ETH);
    await pool.setBalance(new Wallet(UTILITY_PK).address, HUNDRED_ETH);

    ({ bundlerRpcUrl, stop: stopBundler } = await startServers({
      execRpcUrl: pool.rpcUrl,
      entrypoint: entryPointAddress,
      executorPrivateKey: EXECUTOR_PK,
      utilityPrivateKey: UTILITY_PK,
      port: 8551,
    }));

    host = createMockHost({ rpcUrl: pool.rpcUrl });
    ({ protocol } = await getProtocolWithState({
      host,
      chainId,
      initialState: () => loadInitialState(chainId),
      rpcUrl: pool.rpcUrl,
      bundlerUrl: bundlerRpcUrl,
    }));

    await protocol.sync();
  }, 600_000);

  afterAll(async () => {
    try {
      await stopBundler?.();
    } finally {
      await anvil?.stop();
    }
  });

  const balance = async () => (await protocol.balance([nativeAsset]))[0]?.amount ?? 0n;

  /** Deposits one 1 ETH note and prepares a paymaster withdrawal of it. */
  const prepareWithdrawal = async (tailCalls?: (sender: AccountId) => Promise<TxData[]>) => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const { txns } = await protocol.prepareShield({ asset: nativeAsset, amount: NOTE });

    for (const receipt of await sendMultipleTxsAndWait(alice, txns)) {
      expect(receipt!.status).toEqual(1);
    }

    await pool.mine(1);

    const operation = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: NOTE },
      TEST_ACCOUNTS.bob.address as AccountId,
      { mode: 'paymaster', tailCalls },
    );
    const [withdrawal] = operation.withdrawals;

    if (operation.withdrawals.length !== 1 || withdrawal?.mode !== 'paymaster') {
      throw new Error('expected a single paymaster withdrawal');
    }

    return { operation, withdrawal };
  };

  it('[paymaster] throws `unconfirmed` with the hash when the send response was lost', { timeout: 300_000 }, async () => {
    const { operation, withdrawal } = await prepareWithdrawal();
    const bob = TEST_ACCOUNTS.bob.address;
    const bobBefore = await pool.getBalance(bob);
    const balanceBefore = await balance();
    const userOpHash = serializedUserOperationHash(withdrawal.userOperation, entryPointAddress);

    // alto only finds mined userOps, so the lookup right after the lost send
    // cannot tell that it accepted this one.
    const lossy = dropSendResponses(host);
    const error = await catchBroadcastError(createTCBroadcaster(lossy.host).broadcast(operation));

    expect(error.failure).toBe('unconfirmed');
    expect(error.userOpHash).toBe(userOpHash);
    expect(lossy.methods).toEqual(['eth_sendUserOperation', 'eth_getUserOperationByHash']);
    // The bundler did accept it, with the hash computed from the signed userOp.
    expect(lossy.dropped).toEqual([expect.objectContaining({ result: userOpHash })]);

    // It lands anyway.
    const receipt = await createPaymasterBundlerClient(withdrawal.bundlerUrl)
      .waitForUserOperationReceipt({ hash: userOpHash! });

    await pool.mine(1);

    expect(receipt.success).toBe(true);
    expect(await pool.getBalance(bob)).toBeGreaterThan(bobBefore);
    expect(await balance()).toBe(balanceBefore - NOTE);
  });

  it('[paymaster] throws `not-accepted` when the bundler rejects the userOp', { timeout: 300_000 }, async () => {
    const { operation, withdrawal } = await prepareWithdrawal();

    // An invalid sender signature fails validation, so the bundler rejects it.
    const badSignature = `0x${'ab'.repeat(65)}` as const;

    withdrawal.userOperation.signature = badSignature;

    const balanceBefore = await balance();
    const error = await catchBroadcastError(createTCBroadcaster(host).broadcast(operation));

    expect(error.failure).toBe('not-accepted');
    expect(error.message).toMatch(/AA\d\d/);
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain(badSignature);
    expect(error.message).not.toContain(withdrawal.userOperation.paymasterData!.slice(2, 66));

    await pool.mine(1);

    // Nothing was spent.
    expect(await balance()).toBe(balanceBefore);
  });

  it('[paymaster] throws `reverted` when the userOp reverts after spending the note', { timeout: 300_000 }, async () => {
    // The withdrawal pays the sender during validation; the tail call runs in
    // the execution phase afterwards.
    const { operation, withdrawal } = await prepareWithdrawal(
      async () => [{ to: REVERT_TARGET, value: 0n, data: '0x' }],
    );
    const { sender } = withdrawal.userOperation;
    const senderBefore = await pool.getBalance(sender);
    const balanceBefore = await balance();

    // Make the tail call revert now that the userOp is signed.
    await (await pool.getProvider()).send('anvil_setCode', [REVERT_TARGET, ALWAYS_REVERTS]);

    // The bundler accepts it: only the execution phase reverts.
    const [response] = await createTCBroadcaster(host).broadcast(operation);
    const error = await catchBroadcastError(response!.wait());

    await pool.mine(1);

    expect(error.failure).toBe('reverted');
    expect(error.userOpHash).toBe(serializedUserOperationHash(withdrawal.userOperation, entryPointAddress));
    expect(error.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // The note was spent anyway, and its funds are held by the sender.
    expect(await balance()).toBe(balanceBefore - NOTE);
    expect(await pool.getBalance(sender)).toBeGreaterThan(senderBefore);
  });
});
