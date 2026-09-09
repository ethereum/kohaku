import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { decodeFunctionData, getAddress, parseEther, type Hex } from 'viem';
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

// Fresh address (starts at 0 ETH) that only the consolidated forward pays.
const FINAL_RECIPIENT = '0xfe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe0fe03';

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster batch (Level B — real bundler, real prover)', () => {
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

  it('[paymaster] consolidates three notes into one sponsored withdrawal', { timeout: 300_000 }, async () => {
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const provider = await pool.getProvider();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const nativeAsset = ERC20Asset(E_ADDRESS);

    const paymasterConfig: IChainsPaymastersConfig = {
      1: { ...PrivacyPoolsPaymasterConfigs[1]!, bundlerUrl: bundlerRpcUrl },
    };

    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    // One shared prover instance — the batch proves N notes, and a fresh Prover()
    // per note re-downloads circuit artifacts N times (slow + flaky). Retry the
    // init: artifacts are fetched from raw.githubusercontent.com, which rate-limits.
    const makeProver = async () => {
      let lastErr: unknown;

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await Prover();
        } catch (err) {
          lastErr = err;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      throw lastErr;
    };
    const prover = makeProver();

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: () => prover,
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    const broadcaster = new PrivacyPoolsBroadcaster({ host, broadcasterUrl: { default: 'http://unused' } });

    // 1. Three separate native deposits -> three notes.
    for (const amount of [parseEther('0.6'), parseEther('0.5'), parseEther('0.4')]) {
      const { txns: [shieldTx] } = await protocol.prepareShield({ asset: nativeAsset, amount });

      expect((await sendTxAndWait(alice, shieldTx))?.status).toBe(1);
      await pool.mine(1);
    }

    // 2. Approve all three notes via the mock ASP.
    const notes = await protocol.notes([nativeAsset]);

    expect(notes.length).toBe(3);
    notes.forEach((note) => mockAspService.addLabel(note.label));
    await pushNewAspRoot(
      pool.rpcUrl,
      '0x' + ENTRYPOINT_ADDRESS.toString(16),
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    const approvedBefore = unwrapBalance(await protocol.balance([nativeAsset]), nativeAsset).approved?.amount ?? 0n;

    // 3. Withdraw the whole approved balance — spans all three notes — with batch.
    const op = await protocol.prepareUnshield(
      { asset: nativeAsset, amount: approvedBefore },
      FINAL_RECIPIENT as AccountId,
      { mode: 'paymaster', batch: true },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    // callData = executeBatch of [2 direct pool.withdraw, 1 forward].
    const decoded = decodeFunctionData({ abi: SIMPLE_7702_EXECUTE_ABI, data: op.withdrawal.userOperation.callData });

    expect(decoded.functionName).toBe('executeBatch');

    const calls = decoded.args[0] as readonly { target: string; value: bigint; data: string }[];
    const poolHex = getAddress(addressToHex(op.withdrawal.poolAddress));
    const directWithdraws = calls.filter((c) => getAddress(c.target) === poolHex);
    const forward = calls.find((c) => getAddress(c.target) === getAddress(FINAL_RECIPIENT));

    expect(calls.length).toBe(3);
    expect(directWithdraws.length).toBe(2);
    expect(forward?.value).toBeGreaterThan(0n);

    const recipientBefore = await provider.getBalance(FINAL_RECIPIENT);

    expect(recipientBefore).toBe(0n);

    // 4. Broadcast + mine.
    await broadcaster.broadcast(op);
    await pool.mine(1);

    // 5. The consolidated forward paid the recipient (whole amount minus fee), and
    //    all three notes were spent.
    const recipientAfter = await provider.getBalance(FINAL_RECIPIENT);
    const approvedAfter = unwrapBalance(await protocol.balance([nativeAsset]), nativeAsset).approved?.amount ?? 0n;

    expect(recipientAfter).toBeGreaterThan(0n);
    expect(recipientAfter).toBeLessThan(approvedBefore);
    expect(approvedAfter).toBe(0n);
  });
});
