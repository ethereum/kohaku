import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Contract, Wallet } from 'ethers';
import { decodeAbiParameters, parseAbiParameters, parseEther, toHex, type Hex } from 'viem';

import { E_ADDRESS } from '../../../src/config';
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

// A single note without tail calls pays the recipient and its gas refund
// directly. Bundler-estimation fallback preserves callGasLimit = 0, so a disposable
// random sender never takes custody of funds, including after settlement.
describe('TornadoCash Paymaster Unshield E2E — single deposit (direct payout)', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;

  const chainId = inject('chainId');
  const { forkBlockNumber, rpcUrl, paymasterConfig } = getPaymasterChainConfigSetup(chainId);
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
    try {
      await stopBundler?.();
    } finally {
      await anvil?.stop();
    }
  });

  it.each(['existing', 'fresh'])('[prepareUnshieldPaymaster] single note directly pays and refunds recipient (%s) after incompatible bundler estimation', { timeout: 240_000 }, async recipientKind => {
    const nativeAsset = ERC20Asset(E_ADDRESS);
    const host = createMockHost({ rpcUrl: pool.rpcUrl, mnemonic: Wallet.createRandom().mnemonic!.phrase });
    const request = host.provider.request.bind(host.provider);

    host.provider.request = async args => {
      if ((args.method === 'eth_call' || args.method === 'eth_estimateGas') && Array.isArray(args.params) && args.params.length === 3) {
        throw new Error('Host state-override simulation must not be used');
      }

      return request(args);
    };

    const { protocol, broadcaster } = await getProtocolWithState({
      host,
      chainId,
      initialState: () => loadInitialState(chainId),
      rpcUrl: pool.rpcUrl,
      bundlerUrl: bundlerRpcUrl,
    });

    await protocol.sync();

    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const { txns } = await protocol.prepareShield({ asset: nativeAsset, amount: parseEther('1') });

    expect(txns.length).toBeGreaterThan(0);
    const receipts = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of receipts) {
      expect(receipt!.status).toEqual(1);
    }
    await pool.mine(1);

    const [{ amount: preBalance }] = await protocol.balance([nativeAsset]);

    expect(preBalance).toBe(parseEther('1'));

    // Also cover a never-funded EOA, including its creation cost.
    const bob = recipientKind === 'fresh' ? Wallet.createRandom().address : TEST_ACCOUNTS.bob.address;
    const preWithdrawalBalance = await pool.getBalance(bob);
    const prePaymasterBalance = await pool.getBalance(paymasterAddress);

    if (recipientKind === 'fresh') expect(preWithdrawalBalance).toBe(0n);

    const unshieldOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: parseEther('1') },
      bob as AccountId,
      { mode: 'paymaster', delegation: { mode: 'random' } },
    );

    expect(unshieldOp.withdrawals.length).toBe(1);
    const withdrawal = unshieldOp.withdrawals[0]!;

    expect(withdrawal.mode).toBe('paymaster');

    if (withdrawal.mode !== 'paymaster') throw new Error('Expected paymaster withdrawal');

    expect(BigInt(withdrawal.proof.args[2])).toBe(BigInt(bob));
    expect(BigInt(withdrawal.userOperation.sender)).not.toBe(BigInt(bob));
    expect(BigInt(withdrawal.userOperation.callGasLimit)).toBe(0n);
    expect(withdrawal.userOperation.callData).toBe('0x');

    expect(withdrawal.gasEstimation).toMatchObject({ status: 'fallback', reason: 'bundler-internal' });
    expect(BigInt(withdrawal.userOperation.preVerificationGas)).toBe(300_000n);
    expect(BigInt(withdrawal.userOperation.paymasterPostOpGasLimit!)).toBe(50_000n);
    expect(BigInt(withdrawal.userOperation.verificationGasLimit)).toBe(150_000n);
    expect(BigInt(withdrawal.userOperation.paymasterVerificationGasLimit!)).toBe(650_000n);

    if (recipientKind === 'fresh') {
      // Exercise the oldest retained root without mining extra deposits.
      // Classic pools pack currentRootIndex/nextIndex in slot 3. Preserve the
      // deposit count and all roots; only change the ring's starting index on
      // this disposable fork. The original proof must remain valid.
      const [data] = decodeAbiParameters(parseAbiParameters('(address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)'), withdrawal.userOperation.paymasterData!);
      const provider = await pool.getProvider();
      const instance = new Contract(data.instance, [
        'function currentRootIndex() view returns(uint32)',
        'function ROOT_HISTORY_SIZE() view returns(uint32)',
        'function roots(uint256) view returns(bytes32)',
        'function isKnownRoot(bytes32) view returns(bool)',
      ], provider);
      const index = BigInt(await instance.currentRootIndex!());
      const historySize = BigInt(await instance.ROOT_HISTORY_SIZE!());
      const slot = toHex(3n, { size: 32 });
      const packed = BigInt(await provider.send('eth_getStorageAt', [data.instance, slot, 'latest']));

      expect(await instance.roots!(index)).toBe(data.root);
      expect(packed & 0xffffffffn).toBe(index);
      await provider.send('anvil_setStorageAt', [data.instance, slot, toHex((packed & ~0xffffffffn) | ((index + historySize - 1n) % historySize), { size: 32 })]);
      expect(await instance.currentRootIndex!()).toBe((index + historySize - 1n) % historySize);
      expect(await instance.isKnownRoot!(data.root)).toBe(true);
    }

    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    const [{ amount: postTCBalance }] = await protocol.balance([nativeAsset]);
    const postWithdrawalBalance = await pool.getBalance(bob);
    const paymasterBalance = await pool.getBalance(paymasterAddress);

    const proofFee = BigInt(withdrawal.proof.args[4]);
    const retainedFee = paymasterBalance - prePaymasterBalance;
    const recipientReceived = postWithdrawalBalance - preWithdrawalBalance;

    expect(postTCBalance).toBe(0n);
    // The recipient receives the proof-bound net payout AND the unused-gas refund.
    // The paymaster retains only its fee after refunding; gas itself is paid from
    // its separate EntryPoint deposit. Account for the full note, not just the net.
    expect(retainedFee).toBeGreaterThan(0n);
    expect(retainedFee).toBeLessThan(proofFee);
    expect(recipientReceived).toBeGreaterThan(parseEther('1') - proofFee);
    expect(recipientReceived + retainedFee).toBe(parseEther('1'));
    expect(await pool.getBalance(withdrawal.userOperation.sender)).toBe(0n);
  });
});
