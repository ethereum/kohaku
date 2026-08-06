import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { bytesToHex, bytesToNumberLE, numberToBytesLE, randomBytes } from '@noble/curves/utils.js';
import { parseEther, type Hex } from 'viem';

import { E_ADDRESS } from '../../../src/config';
import { ISecretManager, Secret } from '../../../src/account/keys';
import { Commitment, Nullifier, NullifierHash } from '../../../src/interfaces/types.interface';
import { pedersenHash } from '../../../src/utils/proof.util';
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

/**
 * A secret manager that never touches a keystore — its secrets are plain
 * random 31-byte values run through the same Pedersen preimage construction
 * `SecretManager.deriveSecrets` uses (`src/account/keys.ts`), so the
 * resulting commitment is a valid deposit commitment. This is structurally
 * identical to a real standalone (pre-SDK) Tornado Cash note: no BIP32 path,
 * no keystore, no `coalesceSecret` transform.
 */
function createRandomSecretManager(): { manager: ISecretManager; secrets: Secret[] } {
  const secrets: Secret[] = [];

  const manager: ISecretManager = {
    getDepositSecrets: async () => {
      const nullifierBytes = randomBytes(31);
      const nullifier = bytesToNumberLE(nullifierBytes) as Nullifier;
      const salt = bytesToNumberLE(randomBytes(31));
      const preimage = new Uint8Array(62);

      preimage.set(nullifierBytes, 0);
      preimage.set(numberToBytesLE(salt, 31), 31);

      const secret: Secret = {
        nullifier,
        salt,
        commitment: pedersenHash(preimage) as Commitment,
        nullifierHash: pedersenHash(nullifierBytes) as NullifierHash,
      };

      secrets.push(secret);

      return secret;
    },
    deriveEphemeralSigner: () => { throw new Error('not exercised in this test'); },
    deriveDelegatorSigner: () => { throw new Error('not exercised in this test'); },
    deriveLegacyEphemeralSigner: () => { throw new Error('not exercised in this test'); },
  };

  return { manager, secrets };
}

function buildLegacyNoteString(secret: Secret, chainId: number): string {
  const preimage = new Uint8Array(62);

  preimage.set(numberToBytesLE(secret.nullifier, 31), 0);
  preimage.set(numberToBytesLE(secret.salt, 31), 31);

  return `tornado-eth-1-${chainId}-0x${bytesToHex(preimage)}`;
}

describe('TornadoCash Import Legacy Note E2E', () => {
  let anvil: AnvilInstance;
  let pool: AnvilPool;
  let bundlerRpcUrl: string;
  let stopBundler: () => Promise<void>;

  const chainId = inject('chainId');
  const { forkBlockNumber, rpcUrl, paymasterConfig } = getChainConfigSetup(chainId);
  const { entryPointAddress, paymasterAddress } = paymasterConfig;

  beforeAll(async () => {
    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber: Number(forkBlockNumber),
      chainId,
    });
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
      port: 8547,
    }));
  }, 300_000);

  afterAll(async () => {
    await stopBundler();
    await anvil.stop();
  });

  it('imports legacy notes with randomly-generated secrets and withdraws them via paymaster', { timeout: 300_000 }, async () => {
    const nativeAsset = ERC20Asset(E_ADDRESS);

    // 1. Deposit two notes (into the same 1 ETH pool) with a plugin instance
    // whose secrets are pure randomness, not derived from any keystore —
    // simulating real legacy notes. Two deposits (rather than one) force the
    // withdrawal below through paymasterWithdrawThunk's *consolidated* batch
    // path — the only path any existing test exercises. The single-deposit
    // path turns out to be a separate, pre-existing bug unrelated to legacy
    // notes (reproduced with a plain HD-derived deposit too), so this test
    // deliberately avoids it rather than being blocked by it.
    const { manager: randomSecretManager, secrets } = createRandomSecretManager();
    const { protocol: depositorProtocol } = await getProtocolWithState({
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      chainId,
      initialState: () => loadInitialState(chainId),
      rpcUrl: pool.rpcUrl,
      secretManagerFactory: async () => randomSecretManager,
    });

    await depositorProtocol.sync();

    const depositorState = await depositorProtocol.dumpState();
    const depositorPools = Object.values(depositorState)[0]!.pools.poolsTuples.map(([, p]) => p);
    const ethPool = depositorPools.find((p) => p.asset === '0x0' && BigInt(p.denomination) === parseEther('1'))!;

    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const { txns } = await depositorProtocol.prepareShield({ asset: nativeAsset, amount: parseEther('2') });
    const receipts = await sendMultipleTxsAndWait(alice, txns);

    for (const receipt of receipts) {
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toEqual(1);
    }
    await pool.mine(1);

    // Every sync() (including the internal one prepareShield() triggers)
    // also runs discoverUserEventsThunk, which probes getDepositSecrets once
    // per pool looking for a match against already-synced deposits — those
    // calls return random secrets that match nothing and are harmlessly
    // discarded. The two actual deposits' secrets are always generated last
    // (in order), by getDepositPayloadThunk, after any such discovery noise.
    expect(secrets.length).toBeGreaterThanOrEqual(2);
    const [secretA, secretB] = secrets.slice(-2) as [typeof secrets[number], typeof secrets[number]];
    const noteA = buildLegacyNoteString(secretA, chainId);
    const noteB = buildLegacyNoteString(secretB, chainId);

    // 2. Import both notes into a completely independent, ordinary plugin
    // instance ("the user"), who never derived these secrets themselves.
    const { protocol: userProtocol, broadcaster } = await getProtocolWithState({
      host: createMockHost({ rpcUrl: pool.rpcUrl }),
      chainId,
      initialState: () => loadInitialState(chainId),
      rpcUrl: pool.rpcUrl,
      bundlerUrl: bundlerRpcUrl,
    });

    await userProtocol.sync();

    const importResults = await userProtocol.importNotes([noteA, noteB]);

    expect(importResults).toEqual([
      { note: noteA, status: 'imported', poolAddress: BigInt(ethPool.address) },
      { note: noteB, status: 'imported', poolAddress: BigInt(ethPool.address) },
    ]);

    const [{ amount: importedBalance }] = await userProtocol.balance([nativeAsset]);

    expect(importedBalance).toBe(parseEther('2'));

    // 3. Withdraw both imported notes via paymaster. Two deposits force the
    // consolidated batch path, whose default delegator resolution
    // (resolveBatchDelegator, when no explicit `delegation` is given) is
    // `ephemeralSigner(deposits[0])` — since both deposits here are legacy,
    // this exercises `deriveLegacyEphemeralSigner`.
    const bob = TEST_ACCOUNTS.bob.address;
    const preWithdrawalBalance = await pool.getBalance(bob);

    const unshieldOp = await userProtocol.prepareUnshield(
      { asset: nativeAsset, amount: parseEther('2') },
      bob as AccountId,
      { mode: 'paymaster' },
    );

    await broadcaster.broadcast(unshieldOp);
    await pool.mine(1);

    const [{ amount: postTCBalance }] = await userProtocol.balance([nativeAsset]);
    const postWithdrawalBalance = await pool.getBalance(bob);
    const paymasterBalance = await pool.getBalance(paymasterAddress);

    expect(postTCBalance).toBe(0n);
    expect(postWithdrawalBalance).toBeGreaterThan(preWithdrawalBalance);
    expect(paymasterBalance).toBeGreaterThan(0n);
  });
});
