/* eslint-disable max-lines */
import {
  AccountId,
  AssetAmount,
  ERC20AssetId,
  Host,
} from "@kohaku-eth/plugins";
import { proxy } from 'comlink';
import { loadStateManagerWorker } from '#worker-loader';
import { RelayerClient } from '../relayer/relayer-client';

import { addressToHex, } from "../utils.js";
import {
  DepositStrategy,
  TCAssetAmount,
  TCAssetBalance,
  TCInstance,
  TCPaymasterUnshieldOptions,
  TCPrepareShieldOptions,
  TCPrepareUnshieldOptions,
  TCRelayerUnshieldOptions,
} from "../v1/interfaces.js";
import {
  IStateManager,
  TCPrivateOperation,
  TCPublicOperation,
  TCProtocolParams,
} from "./interfaces/protocol-params.interface";
import { E_ADDRESS_BIGINT, TornadoPaymasterConfigs } from "../config";
import { defaultArtifactsLoader } from "../utils/default-artifacts-loader";

type RequireOnly<T, Keys extends keyof T> = Partial<T> & Pick<T, Keys>;

export class TornadoCashProtocol implements TCInstance {
  private stateManager: Promise<IStateManager>;

  constructor(
    readonly host: Host,
    {
      accountIndex = 0,
      initialState = async () => ({}),
      protocolConfig,
      artifactsLoader = defaultArtifactsLoader,
      stateManagerWorkerUrl,
      relayerConfig,
      paymasterConfig = TornadoPaymasterConfigs,
      relayerClientFactory = () => new RelayerClient(host),
      proverVersion
    }: RequireOnly<TCProtocolParams, 'protocolConfig'>,
  ) {
    this.stateManager = (async () => {
      const { remote, onError } = loadStateManagerWorker(stateManagerWorkerUrl);

      const workerReady = new Promise<void>((_resolve, reject) => {
        onError((err: Error) => {
          console.error('[worker crash]', err);
          reject(err);
        });
      });

      await Promise.race([
        remote.init(
          proxy(host.provider),
          proxy(relayerClientFactory()),
          proxy(host.keystore),
          proxy(host.storage),
          proxy(initialState),
          proxy(artifactsLoader),
          { protocolConfig, accountIndex, relayerConfig, paymasterConfig, proverVersion },
        ),
        workerReady,
      ]);

      return {
        sync: () => remote.sync(),
        getBalances: ((assets: bigint[] | undefined) => remote.getBalances(assets)) as unknown as IStateManager['getBalances'],
        getDepositPayload: (params) => remote.getDepositPayload(params),
        getWithdrawalPayloads: (params) => remote.getWithdrawalPayloads(params),
        dumpState: (() => remote.dumpState()) as unknown as IStateManager['dumpState'],
      } as IStateManager;
    })();
  }

  instanceId = () => Promise.resolve("0x1" as const);

  /**
   * Only process supported assets or error out?
   * Returns the balances of the requested assets.
   * The assets retain the provided order. If an asset is not supported its balance will be 0
   */
  async balance(assets: ERC20AssetId[] = []): Promise<TCAssetBalance[]> {
    const stateManager = await this.stateManager;

    await stateManager.sync();
    const parsedDesiredAssets = assets.map(({ contract }) => {
      const parsedAddress = BigInt(contract);

      return parsedAddress === E_ADDRESS_BIGINT ? 0n : parsedAddress;
    });

    const balances = await stateManager.getBalances(
      assets.length > 0 ? parsedDesiredAssets : undefined,
    );
    
    const actuallySelectedAssets = assets.length > 0 ? assets.map((a) => a.contract) : [...balances.keys()].map((a) => addressToHex(a))

    return actuallySelectedAssets.map((assetAddress, index) => {
      const parsedSelectedAsset = BigInt(actuallySelectedAssets[index]!);
      const balance = balances.get(parsedSelectedAsset === E_ADDRESS_BIGINT ? 0n : parsedSelectedAsset) || 0n;

      const asset: ERC20AssetId = {
        contract: assetAddress,
        __type: 'erc20'
      }; 

      return {
        asset,
        amount: balance,
      };
    });
  }

  async prepareShield(
    assets: TCAssetAmount,
    options?: TCPrepareShieldOptions | `0x${string}`
  ): Promise<TCPublicOperation> {
    const { asset, amount } = assets;
    const strategy = typeof options === 'string' ? DepositStrategy.MinFee : options?.strategy || DepositStrategy.MinFee;
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const parsedAsset = BigInt(asset.contract);

    const tx = await stateManager.getDepositPayload({
      asset: parsedAsset === E_ADDRESS_BIGINT ? 0n : parsedAsset,
      amount,
      strategy,
    });

    return { txns: tx } as TCPublicOperation;
  }

  async prepareUnshield(
    assets: AssetAmount,
    to: AccountId,
    options?: TCRelayerUnshieldOptions,
  ): Promise<TCPrivateOperation<'relayer'>>
  async prepareUnshield(
    assets: AssetAmount,
    to: AccountId,
    options?: TCPaymasterUnshieldOptions,
  ): Promise<TCPrivateOperation<'paymaster'>>
  async prepareUnshield(
    assets: AssetAmount,
    to: AccountId,
    options?: TCPrepareUnshieldOptions,
  ): Promise<TCPrivateOperation<'paymaster' | 'relayer'>> {
    const { asset, amount } = assets;
    const parsedAsset = BigInt((asset as ERC20AssetId).contract || E_ADDRESS_BIGINT);
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const baseParams = {
      asset: parsedAsset === E_ADDRESS_BIGINT ? 0n : parsedAsset,
      amount,
      recipient: BigInt(to),
    };

    let withdrawals: Awaited<ReturnType<IStateManager['getWithdrawalPayloads']>>;

    if (options && options.mode === 'paymaster') {
      withdrawals = await stateManager.getWithdrawalPayloads({
        ...baseParams,
        mode: 'paymaster',
        delegation: options.delegation
      });
    } else {
      withdrawals = await stateManager.getWithdrawalPayloads({
        ...baseParams,
        mode: 'relayer',
        preferredRelayersEns: options?.preferredRelayersEns,
      });
    }

    return {
      __type: 'privateOperation',
      withdrawals
    } as TCPrivateOperation;
  }

  async sync() {
    const stateManager = await this.stateManager;

    return stateManager.sync();
  }

  async dumpState() {
    const stateManager = await this.stateManager;

    return stateManager.dumpState();
  }
}
