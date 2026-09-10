import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { AccountId } from '@kohaku-eth/plugins';
import { decodeAbiParameters, getAddress, parseAbiParameters } from 'viem';

import { PrivacyPoolsPaymasterConfigs } from '../../../src/config';
import { DataService } from '../../../src/data/data.service';
import { EthClient } from '../../../src/data/eth-client';
import { PrivacyPoolsV1Protocol } from '../../../src/index';
import { addressToHex } from '../../../src/utils';
import { getChainConfigSetup } from '../../constants';
import { defineAnvil, type AnvilInstance } from '../../utils/anvil';
import { ERC20Asset, InitialState, loadInitialState, unwrapBalance } from '../../utils/common';
import { createMockHost } from '../../utils/mock-host';
import { mockProverFactory } from '../../utils/mock-prover';
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

// The bundler is external infra, so we stub only the two network calls the
// prepare phase makes. The paymaster oracle (quoteWeiInToken) is NOT stubbed —
// it runs against the real deployed paymaster on the fork.
const MOCK_GAS_PRICE = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };

vi.mock('../../../src/paymaster/utils', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/paymaster/utils')>();

  return {
    ...actual,
    getUserOperationGasPrice: vi.fn(async () => ({
      slow: MOCK_GAS_PRICE,
      standard: MOCK_GAS_PRICE,
      fast: MOCK_GAS_PRICE,
    })),
    // Force the safe-baseline fallback (no live bundler to estimate against).
    estimateUserOperationGas: vi.fn(async () => {
      throw new Error('bundler estimation unavailable in test');
    }),
  };
});

// The paymaster + adapters are deployed on mainnet, so this suite forks the
// mainnet RPC and only runs on the mainnet project. Pool state is hydrated from
// saga-sync (fast); override SAGA_SYNC_URL to point elsewhere.
const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'] ?? 'https://saga.fatsolutions.xyz';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_BALANCE_SLOT = 2;
const USDT_POOL = 0xe859c0bd25f260baee534fb52e307d3b64d24572n;
const USDT_ADAPTER = '0xFcA5515D05f372Db8E03Bcc6b1a96BF4aC006f33';
const SIMPLE_7702_IMPL = '0xe6Cae83BdE06E4c305530e199D7217f42808555B';

const chainId = inject('chainId');

describe.skipIf(chainId !== 1)('PrivacyPools v1 paymaster unshield — real oracle (mainnet fork)', () => {
  let anvil: AnvilInstance;
  let latestState: InitialState;

  const { entrypoint, postman, rpcUrl } = getChainConfigSetup(1);
  const ENTRYPOINT_ADDRESS = entrypoint.address;
  const ENTRYPOINT_HEX = addressToHex(ENTRYPOINT_ADDRESS);
  const paymasterConfig = PrivacyPoolsPaymasterConfigs;
  const PAYMASTER_ADDRESS = paymasterConfig[1]!.paymasterAddress;

  beforeAll(async () => {
    // Fork mainnet at its head (where the paymaster + adapters are deployed).
    anvil = await defineAnvil({ forkUrl: rpcUrl, chainId: 1 });
    await anvil.start();

    const pool = anvil.pool(1);
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    // Optionally hydrate the heavy pool-event history from saga-sync; the
    // entrypoint (not a saga stream) and any blocks past saga's coverage still
    // come from the fork over RPC — result-identical, just far fewer round trips.
    let dataService: DataService | undefined;

    if (SAGA_SYNC_URL) {
      const rpcLogs = new EthClient(host.provider);
      const headBlock = BigInt(await pool.getBlockNumber());
      const sagaLogs = await createSagaLogSource({
        sourceUrl: SAGA_SYNC_URL,
        chainId: 1,
        headBlock,
        fallback: (params) => rpcLogs.getLogs(params),
      });

      dataService = new DataService({ provider: host.provider, getLogs: sagaLogs });
    }

    const { protocol } = await getProtocolWithState({
      entrypoint,
      initialState: () => loadInitialState(1),
      host,
      rpcUrl: pool.rpcUrl,
      postman,
      ...(dataService ? { dataService } : {}),
    });

    // Reconciles the snapshot up to the fork head so a fresh deposit's Merkle
    // state matches chain.
    await protocol.sync();
    latestState = protocol.dumpState();
  }, 600000);

  afterAll(async () => {
    await anvil.stop();
  });

  it('[prepareUnshield/paymaster] prices the gas fee via the real paymaster oracle for a USDT withdrawal', { timeout: 300_000 }, async () => {
    const pool = anvil.pool(20);
    const alice = await setupWallet(pool, TEST_ACCOUNTS.alice.privateKey);
    const host = createMockHost({ rpcUrl: pool.rpcUrl });
    const dataService = new DataService({ provider: host.provider });

    // Sanity: the real oracle answers on the fork (2.39 USDT ≈ 0.001 ETH).
    const directQuote = await dataService.quoteWeiInToken(BigInt(PAYMASTER_ADDRESS), BigInt(USDT), 10n ** 15n);

    expect(directQuote).toBeGreaterThan(0n);

    const usdtAsset = ERC20Asset(USDT);
    const mockAspService = await setupMockAspForTest(pool.rpcUrl, ENTRYPOINT_ADDRESS, postman);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: async () => latestState,
      proverFactory: mockProverFactory,
      aspServiceFactory: () => mockAspService,
      relayersList: {},
      paymasterConfig,
    });

    const DEPOSIT_AMOUNT = 1_000_000_000n; // 1,000 USDT (6 decimals)
    const WITHDRAW_AMOUNT = 500_000_000n; // 500 USDT

    // 1. Fund + deposit USDT.
    await fundAccountWithERC20(pool.rpcUrl, USDT, alice.address, DEPOSIT_AMOUNT, USDT_BALANCE_SLOT);
    const approval = await approveERC20(alice, USDT, ENTRYPOINT_HEX, DEPOSIT_AMOUNT);

    expect(approval?.status).toBe(1);

    const { txns: [shieldTx] } = await protocol.prepareShield({ asset: usdtAsset, amount: DEPOSIT_AMOUNT });
    const depositReceipt = await sendTxAndWait(alice, shieldTx);

    expect(depositReceipt?.status).toBe(1);
    await pool.mine(1);

    // 2. Approve the note via the mock ASP.
    const [note] = await protocol.notes([usdtAsset]);

    mockAspService.addLabel(note.label);
    await pushNewAspRoot(
      pool.rpcUrl,
      ENTRYPOINT_HEX,
      '0x' + BigInt(postman).toString(16),
      { _root: mockAspService.getRoot(), _ipfsCID: MOCK_IPFS_CID },
    );

    const approved = unwrapBalance(await protocol.balance([usdtAsset]), usdtAsset).approved;

    expect(approved?.amount).toBeGreaterThan(0n);

    // 3. Prepare the paymaster withdrawal — this drives quoteWeiInToken on the
    //    real paymaster through our thunk.
    const op = await protocol.prepareUnshield(
      { asset: usdtAsset, amount: WITHDRAW_AMOUNT },
      alice.address as AccountId,
      { mode: 'paymaster' },
    );

    if (op.mode !== 'paymaster') throw new Error('expected paymaster operation');

    const { withdrawal } = op;

    // 4. Assert the ERC20 path routed to the right adapter and built a signed op.
    expect(withdrawal.isERC20).toBe(true);
    expect(withdrawal.poolAddress).toBe(USDT_POOL);
    expect(withdrawal.paymasterAddress).toBe(PAYMASTER_ADDRESS);

    const { userOperation } = withdrawal;

    expect(userOperation.callData).toBe('0x');
    expect(userOperation.nonce).toBe('0x0');
    expect(userOperation.paymaster).toBe(PAYMASTER_ADDRESS);
    // paymasterData = abi.encode(PaymasterData{ adapter, adapterData }); the
    // adapter must be the USDT pool's fee adapter.
    const [decodedPaymasterData] = decodeAbiParameters(
      parseAbiParameters('(address adapter, bytes adapterData)'),
      userOperation.paymasterData!,
    );

    expect(getAddress(decodedPaymasterData.adapter)).toBe(getAddress(USDT_ADAPTER));
    expect(userOperation.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(userOperation.eip7702Auth?.address.toLowerCase()).toBe(SIMPLE_7702_IMPL.toLowerCase());
  });
});
