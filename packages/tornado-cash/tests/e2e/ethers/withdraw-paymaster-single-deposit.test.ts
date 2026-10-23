import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { parseEther, type Hex } from 'viem';

import { E_ADDRESS } from '../../../src/config';
import { AnvilPool, defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, loadInitialState } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getProtocolWithState, sendMultipleTxsAndWait, setupWallet } from '../../utils/test-helpers';
import { getChainConfigSetup } from '../../constants';

const DEPLOYER_PK = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as Hex;
const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK  = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;
const HUNDRED_ETH = `0x${parseEther('100').toString(16)}`;

// A single deposit (no tailCalls) never needs consolidation — the paymaster
// releases funds straight to the recipient during validation instead of
// through an execution-phase call (see paymasterWithdrawThunk.ts). Every
// other paymaster e2e test happens to select 2+ deposits per withdrawal, so
// this path went completely uncovered and shipped with a `paymasterVerificationGasLimit`
// baseline (350_000n) that left only ~2.5k gas of headroom over the ~347.5k
// a real pool.withdraw (groth16 verify + merkle proof) actually costs —
// nowhere near enough for the surrounding paymaster/adapter overhead, causing
// a silent out-of-gas revert. This test pins the single-deposit path down.
describe('TornadoCash Paymaster Unshield E2E — single deposit (no consolidation)', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;

  const chainId = inject('chainId');
  const { forkBlockNumber, rpcUrl, paymasterConfig } = getChainConfigSetup(chainId);
  const { entryPointAddress, paymasterAddress } = paymasterConfig;

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
      port: 8549,
    }));
  }, 300_000);

  afterAll(async () => {
    await stopBundler();
    await anvil.stop();
  });

  it('[prepareUnshieldPaymaster] single native deposit withdraws without consolidation', { timeout: 180_000 }, async () => {
    const nativeAsset = ERC20Asset(E_ADDRESS);

    const { protocol, broadcaster } = await getProtocolWithState({
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      chainId,
      initialState: () => loadInitialState(chainId),
      rpcUrl: pool.rpcUrl,
      bundlerUrl: bundlerRpcUrl,
    });

    await protocol.sync();

    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const { txns } = await protocol.prepareShield({ asset: nativeAsset, amount: parseEther('1') });
    const receipts = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of receipts) {
      expect(receipt!.status).toEqual(1);
    }
    await pool.mine(1);

    const [{ amount: preBalance }] = await protocol.balance([nativeAsset]);

    expect(preBalance).toBe(parseEther('1'));

    const bob = TEST_ACCOUNTS.bob.address;
    const preWithdrawalBalance = await pool.getBalance(bob);

    const unshieldOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: parseEther('1') },
      bob as AccountId,
      { mode: 'paymaster' },
    );

    expect(unshieldOp.withdrawals.length).toBe(1);

    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    const [{ amount: postTCBalance }] = await protocol.balance([nativeAsset]);
    const postWithdrawalBalance = await pool.getBalance(bob);
    const paymasterBalance = await pool.getBalance(paymasterAddress);

    expect(postTCBalance).toBe(0n);
    expect(postWithdrawalBalance).toBeGreaterThan(preWithdrawalBalance);
    expect(paymasterBalance).toBeGreaterThan(0n);
  });
});
