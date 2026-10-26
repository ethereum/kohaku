import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { toHex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TornadoCashConfigs, TornadoPaymasterConfigs } from '../../src/config';
import { IDataService } from '../../src/data/interfaces/data.service.interface';
import { IIndexedDepositWithSecrets, IPool } from '../../src/data/interfaces/events.interface';
import { Address } from '../../src/interfaces/types.interface';
import { IRelayerWithdrawalPayload } from '../../src/plugin/interfaces/protocol-params.interface';
import { IRelayerClient, IRelayerStatusResponse } from '../../src/relayer/interfaces/relayer-client.interface';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { IRelayerFeeConfig, registerRelayers, setRelayerFeeConfig } from '../../src/state/slices/relayersSlice';
import { storeFactory } from '../../src/state/store';
import { withdrawThunk } from '../../src/state/thunks/withdrawThunk';
import type { WithdrawalProofsThunkParams } from '../../src/state/thunks/withdrawalsProofThunk';
import { ITornadoProver } from '../../src/utils/tornado-prover';

const { deposits, proofCalls } = vi.hoisted(() => ({
  deposits: [] as unknown[],
  proofCalls: [] as { fee: bigint; relayerAddress: bigint }[],
}));

// Isolate fee selection: note lookup, root verification and proving are covered elsewhere.
vi.mock('../../src/state/selectors/withdrawals.selector', async (importOriginal) => ({
  ...await importOriginal<object>(),
  getWithdrawableDepositsSelector: () => deposits,
}));
vi.mock('../../src/state/thunks/verifyRootsThunk', () => ({
  verifyRootsThunk: createAsyncThunk('sync/verifyRoots', async () => {}),
}));
vi.mock('../../src/state/thunks/withdrawalsProofThunk', () => ({
  withdrawalsProofThunk: createAsyncThunk(
    'withdraw/generateProofs',
    async ({ fee, relayerAddress, recipient }: WithdrawalProofsThunkParams) => {
      proofCalls.push({ fee, relayerAddress });

      return {
        proof: '0x00',
        args: ['0x01', '0x02', toHex(recipient), toHex(relayerAddress), toHex(fee), '0x0'],
      };
    },
  ),
}));

const DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0Fn as Address;
const DAI_100 = 0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3n as Address;
const ETH_01 = 0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fcn as Address;
const ONE_DAI = 10n ** 18n;
const GWEI = 10n ** 9n;
const NETWORK_FEE_1_GWEI = 550_000n * GWEI; // WITHDRAW_GAS at 1 gwei
const DAI_PER_ETH = 2_300n;
const FAIR_DAI_PRICE = 10n ** 18n / DAI_PER_ETH; // wei per DAI

const HONEST = 'honest.eth';
const MALICIOUS = 'malicious.eth';
const CHEAP_LOOKING = 'cheap-looking.eth';

function pool(address: Address, asset: Address, denomination: bigint): IPool {
  return {
    address,
    asset,
    isERC20: asset !== 0n,
    protocolFeePercentage: 0,
    denomination,
    registeredBlock: 0n,
    state: 1,
    rootHistorySize: 100,
  };
}

function status(overrides: Partial<IRelayerStatusResponse>): IRelayerStatusResponse {
  return {
    currentQueue: 0,
    netId: 1,
    rewardAccount: '0x00000000000000000000000000000000000000aa',
    version: '1',
    tornadoServiceFee: 0.1,
    ethPrices: { dai: FAIR_DAI_PRICE.toString() },
    ...overrides,
  };
}

const STATUSES: Record<string, IRelayerStatusResponse> = {
  [HONEST]: status({ rewardAccount: '0x00000000000000000000000000000000000000aa' }),
  // Lowest advertised service fee, but prices DAI so the network fee is 95 DAI.
  [MALICIOUS]: status({
    rewardAccount: '0x00000000000000000000000000000000000000bb',
    tornadoServiceFee: 0.01,
    ethPrices: { dai: (NETWORK_FEE_1_GWEI * ONE_DAI / (95n * ONE_DAI)).toString() },
  }),
  // Lower service fee than HONEST and a price 15% off (inside the tolerance): costs more in total.
  [CHEAP_LOOKING]: status({
    rewardAccount: '0x00000000000000000000000000000000000000cc',
    tornadoServiceFee: 0.05,
    ethPrices: { dai: (FAIR_DAI_PRICE * 100n / 115n).toString() },
  }),
};

const relayerClient: IRelayerClient = {
  getStatus: async (hostname) => STATUSES[hostname]!,
  withdraw: async () => { throw new Error('not used'); },
};

function storeWith(relayers: string[], feeConfig?: IRelayerFeeConfig) {
  const store = storeFactory({ protocolConfig: { ...TornadoCashConfigs[1], chainId: 1n }, logLevel: 'off' });

  store.dispatch(registerPools([pool(DAI_100, DAI, 100n * ONE_DAI), pool(ETH_01, 0n, 10n ** 17n)]));
  store.dispatch(registerRelayers(relayers.map((ensName, i) => ({
    ensName,
    hostname: ensName,
    relayerAddress: BigInt(i + 1),
    stakeBalance: 1n,
  }))));

  if (feeConfig) store.dispatch(setRelayerFeeConfig(feeConfig));

  return store;
}

function dataService({ gasPrice = GWEI, twap = true } = {}) {
  return {
    getGasPrice: vi.fn().mockResolvedValue(gasPrice),
    // The paymaster's TWAP: DAI_PER_ETH DAI per ETH, or reverting (unsupported token).
    quoteWeiInToken: vi.fn(async (_paymaster: Address, _token: Address, wei: bigint) => {
      if (!twap) throw new Error('execution reverted');

      return wei * DAI_PER_ETH;
    }),
  };
}

async function withdraw(store: ReturnType<typeof storeWith>, asset: Address, service = dataService()) {
  return store.dispatch(withdrawThunk({
    relayerClient,
    dataService: service as unknown as IDataService,
    assetAddress: asset,
    recipient: 0x1234n,
    proverFactory: async () => ({}) as ITornadoProver,
    paymasterConfig: TornadoPaymasterConfigs,
  }));
}

function noteIn(poolAddress: Address) {
  deposits.splice(0, deposits.length, { pool: poolAddress, commitment: 1n, kind: 'derived' } as unknown as IIndexedDepositWithSecrets);
}

const fairNetworkFee = NETWORK_FEE_1_GWEI * DAI_PER_ETH; // in DAI base units
const serviceFee = (denomination: bigint, percent: bigint) => denomination * percent / 10_000n;

describe('relayer fee checks', () => {
  beforeEach(() => {
    proofCalls.length = 0;
    noteIn(DAI_100);
  });

  it('rejects a relayer price above the paymaster TWAP and proves with the honest relayer', async () => {
    const service = dataService();
    const [payload] = unwrapResult(await withdraw(storeWith([MALICIOUS, HONEST]), DAI, service)) as IRelayerWithdrawalPayload[];

    expect(service.quoteWeiInToken).toHaveBeenCalledWith(BigInt(TornadoPaymasterConfigs[1].paymasterAddress), DAI, NETWORK_FEE_1_GWEI);
    expect(payload!.relayerUrl).toBe(`https://${HONEST}/`);
    expect(proofCalls).toEqual([{ fee: payload!.fee, relayerAddress: 0xaan }]);
    // The relayer price differs from the TWAP by integer rounding only.
    expect(payload!.fee - (fairNetworkFee + serviceFee(100n * ONE_DAI, 10n))).toBeLessThan(10n ** 6n);
    expect(payload!.denomination).toBe(100n * ONE_DAI);
    expect(BigInt(payload!.proof.args[4])).toBe(payload!.fee);
  });

  it('caps the fee when no independent price is available', async () => {
    const [payload] = unwrapResult(await withdraw(storeWith([MALICIOUS, HONEST]), DAI, dataService({ twap: false }))) as IRelayerWithdrawalPayload[];

    expect(payload!.relayerUrl).toBe(`https://${HONEST}/`);
  });

  it('refuses to prove when every relayer is over the limits', async () => {
    for (const twap of [true, false]) {
      const result = await withdraw(storeWith([MALICIOUS]), DAI, dataService({ twap }));

      expect(() => unwrapResult(result)).toThrow(/No relayer quote within fee limits \(malicious\.eth: /);
    }

    expect(proofCalls).toEqual([]);
  });

  it('picks the lowest total fee, not the lowest advertised service fee', async () => {
    const [payload] = unwrapResult(await withdraw(storeWith([CHEAP_LOOKING, HONEST]), DAI)) as IRelayerWithdrawalPayload[];

    expect(payload!.relayerUrl).toBe(`https://${HONEST}/`);
  });

  it('caps ETH fees driven by the RPC gas price, configurable through relayerConfig', async () => {
    noteIn(ETH_01);

    // 50 gwei * 550k = 0.0275 ETH: 27.5% of a 0.1 ETH note.
    const spike = dataService({ gasPrice: 50n * GWEI });
    const rejected = await withdraw(storeWith([HONEST]), 0n, spike);

    expect(() => unwrapResult(rejected)).toThrow(/is more than 20% of the 100000000000000000 note/);
    expect(proofCalls).toEqual([]);

    const allowed = storeWith([HONEST], { minFee: 0.01, maxFee: 0.3, maxTotalFeeBps: 3_000 });
    const [payload] = unwrapResult(await withdraw(allowed, 0n, spike)) as IRelayerWithdrawalPayload[];

    expect(payload!.fee).toBe(50n * NETWORK_FEE_1_GWEI + serviceFee(10n ** 17n, 10n));
    expect(spike.quoteWeiInToken).not.toHaveBeenCalled();
  });
});
