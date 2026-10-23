import { Prover } from '@fatsolutions/privacy-pools-core-circuits';
import { AccountId } from '@kohaku-eth/plugins';
import { startServers } from '@privacy-paymasters/sdk/bundler-server';
import { Wallet } from 'ethers';
import { createPublicClient, erc20Abi, http, parseUnits, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PrivacyPoolsPaymasterConfigs } from '../../../src/config';
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

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
// Fresh address (starts empty) that only this withdrawal pays.
const EXACT_RECIPIENT = '0xec01ec01ec01ec01ec01ec01ec01ec01ec01ec01';

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster exact output (real bundler, real prover)', () => {
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

    await pool.setBalance(new Wallet(EXECUTOR_PK).address, `0x${parseUnits('100', 18).toString(16)}`);
    await pool.setBalance(new Wallet(UTILITY_PK).address, `0x${parseUnits('100', 18).toString(16)}`);

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

  // Exact output with the paymaster flow is discouraged: the paymaster refunds the gas
  // overcharge to the recipient in postOp, so the recipient nets MORE than the requested
  // exact amount. This test pins that behavior (see prepareUnshield's docs).
  it('[paymaster] exact output over-delivers by the postOp gas refund', { timeout: 300_000 }, async () => {
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
    const REQUESTED_NET = parseUnits('200', 6);

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

    expect(approvedBefore).toBeGreaterThanOrEqual(REQUESTED_NET);

    // 3. Exact + paymaster requires an explicit refund target — omitting it is rejected.
    await expect(
      protocol.prepareUnshield(
        { asset: usdcAsset, amount: REQUESTED_NET },
        EXACT_RECIPIENT as AccountId,
        { mode: 'paymaster', exact: {} },
      ),
    ).rejects.toThrow(/refundRecipient/);

    // Exact-output withdrawal via the paymaster. The gross is sized so the recipient nets
    // REQUESTED_NET before the refund; we deliberately point the refund at the recipient
    // to exercise the over-delivery case.
    const op = await protocol.prepareUnshield(
      { asset: usdcAsset, amount: REQUESTED_NET },
      EXACT_RECIPIENT as AccountId,
      { mode: 'paymaster', exact: {}, refundRecipient: EXACT_RECIPIENT as AccountId },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    // The resolved exact figures target the requested net (computed before the refund).
    expect(op.exact?.expectedNet).toBe(REQUESTED_NET);

    const recipientBefore = await usdcBalance(EXACT_RECIPIENT);

    expect(recipientBefore).toBe(0n);

    // 4. Broadcast + mine.
    await broadcaster.broadcast(op);
    await pool.mine(1);

    // 5. The recipient received MORE than the exact/expected net — the paymaster's postOp
    //    gas-overcharge refund is routed to them on top — bounded above by the gross
    //    actually withdrawn from the note.
    const received = (await usdcBalance(EXACT_RECIPIENT)) - recipientBefore;
    const approvedAfter = unwrapBalance(await protocol.balance([usdcAsset]), usdcAsset).approved?.amount ?? 0n;

    expect(received).toBeGreaterThan(op.exact!.expectedNet);
    expect(received).toBeLessThan(op.exact!.grossAmount);
    expect(approvedAfter).toBe(approvedBefore - op.exact!.grossAmount);
  });
});
