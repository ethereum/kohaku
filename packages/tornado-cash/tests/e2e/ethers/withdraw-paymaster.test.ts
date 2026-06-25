import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
// import { deployPaymaster } from 'privacy-paymaster/deploy-paymaster';
import { Wallet } from 'ethers';
import { parseEther, type Hex } from 'viem';

import { E_ADDRESS } from '../../../src/config';
import { AnvilPool, defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, loadInitialState } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { TEST_ACCOUNTS } from '../../utils/test-accounts';
import { getERC20Balance, getProtocolWithState, sendMultipleTxsAndWait, setUniswapV3PoolPrice, setupWallet, transferERC20FromWhale } from '../../utils/test-helpers';
import { getChainConfigSetup } from '../../constants';
import { TCBroadcaster, TornadoCashProtocol } from '@kohaku-eth/tornado-cash';
import { Serializable } from '../../../src/state/interfaces/utils.interface';
import { IPool } from '../../../src/data/interfaces/events.interface';

const DEPLOYER_PK = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as Hex;
const EXECUTOR_PK = '0x4a3a02862ddcb260ed52d40ef03f8e3d78fa3d174b0ef333afdf1ffb4a648cd5' as Hex;
const UTILITY_PK  = '0xdd4b2564c83ff7de602c39ffda1146055dc1814b07c083d7971722384f1f01a6' as Hex;
const HUNDRED_ETH = `0x${parseEther('100').toString(16)}`;

describe('TornadoCash Paymaster Unshield E2E', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let protocol: TornadoCashProtocol;
  let broadcaster: TCBroadcaster;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;
  let erc20Pool: Serializable<IPool>;
  
  const chainId = inject('chainId');
  const { forkBlockNumber, rpcUrl, paymasterConfig, erc20Address, erc20WhaleAddress } = getChainConfigSetup(chainId);
  const { entryPointAddress, paymasterAddress } = paymasterConfig;

  beforeAll(async () => {
    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber: Number(forkBlockNumber),
      chainId,
    });
    await anvil.start();

    pool = anvil.pool(1);

    // Fund deployer and bundler accounts on the fork
    await pool.setBalance(new Wallet(DEPLOYER_PK).address, HUNDRED_ETH);
    await pool.setBalance(new Wallet(EXECUTOR_PK).address, HUNDRED_ETH);
    await pool.setBalance(new Wallet(UTILITY_PK).address, HUNDRED_ETH);

    // Deploy PrivacyPaymaster + TornadoAccount onto this fork
    // ({ paymasterAddress, tornadoAccountAddress } = await deployPaymaster({
    //   forkUrl: pool.rpcUrl,
    //   privateKey: DEPLOYER_PK,
    //   deployEnv,
    // }));

    // Start alto bundler connected to this fork
    ({ bundlerRpcUrl, stop: stopBundler } = await startServers({
      execRpcUrl: pool.rpcUrl,
      entrypoint: entryPointAddress,
      executorPrivateKey: EXECUTOR_PK,
      utilityPrivateKey: UTILITY_PK,
      port: 8546
    }));

    ({ protocol, broadcaster } = await getProtocolWithState({
      chainId,
      initialState: () => loadInitialState(chainId),
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      rpcUrl: pool.rpcUrl,
      bundlerUrl: bundlerRpcUrl
    }));
    await protocol.sync();

    const state = await protocol.dumpState();

    const protocolPools = Object.values(state)[0].pools.poolsTuples.map(([_, pool]) => pool);

    erc20Pool = protocolPools.find((p) => BigInt(p.asset) === BigInt(erc20Address))!;
  }, 300_000);

  afterAll(async () => {
    await stopBundler();
    await anvil.stop();
  });

  it('[prepareUnshieldPaymaster] Native withdrawal succeeds', { timeout: 180_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);

    const nativeAsset = ERC20Asset(E_ADDRESS);
    const DEPOSIT_AMOUNT = parseEther('1.2');
    const WITHDRAW_AMOUNT = parseEther('1.1');

    // 1. Deposit
    const { txns } = await protocol.prepareShield({ asset: nativeAsset, amount: DEPOSIT_AMOUNT });
    const receipts = await sendMultipleTxsAndWait(alice, txns);
  
    for (const receipt of receipts) {
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
    }
    await pool.mine(1);

    // 2. Verify deposit balance
    const [{ amount }] = await protocol.balance([nativeAsset]);

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // 3. Prepare paymaster withdrawal
    const unshieldOp = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: WITHDRAW_AMOUNT },
      alice.address as AccountId,
      { mode: 'paymaster' },
    );

    const preWithdrawalBalance = await pool.getBalance(alice.address);

    // 4. Broadcast — TornadoCashBroadcaster routes paymaster withdrawals to PaymasterBroadcaster
    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    // 5. Assert
    const [{ amount: postTCBalance }] = await protocol.balance([nativeAsset]);
    const postWithdrawalBalance = await pool.getBalance(alice.address);
    const paymasterBalance = await pool.getBalance(paymasterAddress);

    expect(postTCBalance).toBe(DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    expect(postWithdrawalBalance).toBeGreaterThan(preWithdrawalBalance);
    expect(paymasterBalance).toBeGreaterThan(0n);
  });

  it('[prepareUnshieldPaymaster] ERC20 withdrawal succeeds', { timeout: 180_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const erc20Asset = ERC20Asset(erc20Address);

    const baseDepositAmount = BigInt(erc20Pool.denomination)

    const DEPOSIT_AMOUNT = baseDepositAmount * 3n;
    const WITHDRAW_AMOUNT = baseDepositAmount * 2n;

    await transferERC20FromWhale(pool.rpcUrl, erc20Address, erc20WhaleAddress, alice.address, DEPOSIT_AMOUNT);
    
    // 1. Deposit
    const { txns } = await protocol.prepareShield({ asset: erc20Asset, amount: DEPOSIT_AMOUNT });
    const receipts = await sendMultipleTxsAndWait(alice, txns);
  
    for (const receipt of receipts) {
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
    }
    await pool.mine(1);

    const rawBalance = await protocol.balance([erc20Asset])

    // 2. Verify deposit balance
    const { amount } = rawBalance.find((b) => BigInt(b.asset.contract) === BigInt(erc20Asset.contract))!;

    expect(amount).toBe(DEPOSIT_AMOUNT);

    // Sepolia's WETH/DAI pools are arbitrarily priced, so both the SDK fee quote
    // and the paymaster's on-chain TWAP value gas at absurd rates. Override the
    // configured (0.05%) DAI/WETH pool to a realistic 3000 DAI/ETH so the fee
    // fits under the note denomination and the paymaster accepts it.
    const DAI_WETH_500_POOL = '0x122450AE55BD9B74768A128Bda99906351F81827';
    await setUniswapV3PoolPrice(pool, DAI_WETH_500_POOL, 3000n);

    // 3. Prepare paymaster withdrawal
    const unshieldOp = await protocol.prepareUnshield(
      { asset: erc20Asset, amount: WITHDRAW_AMOUNT },
      alice.address as AccountId,
      { mode: 'paymaster' },
    );

    const preWithdrawalBalance = await getERC20Balance(pool.rpcUrl, erc20Address, alice.address);

    // 4. Broadcast — TornadoCashBroadcaster routes paymaster withdrawals to PaymasterBroadcaster
    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    // 5. Assert
    const [{ amount: postTCBalance }] = await protocol.balance([erc20Asset]);
    const postWithdrawalBalance = await getERC20Balance(pool.rpcUrl, erc20Address, alice.address);
    const paymasterBalance = await getERC20Balance(pool.rpcUrl, erc20Address, paymasterAddress);

    expect(postTCBalance).toBe(DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    expect(postWithdrawalBalance).toBeGreaterThan(preWithdrawalBalance);
    expect(paymasterBalance).toBeGreaterThan(0n);
  });
});
